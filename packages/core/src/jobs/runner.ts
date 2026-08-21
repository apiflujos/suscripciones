import { hasExhaustedCycleAttempts } from "../services/collectionAttempts";
import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { loadEnv } from "../config/env";
import { LogLevel, PaymentStatus, RetryJobStatus, RetryJobType, WebhookProcessStatus, WebhookProvider } from "@prisma/client";
import { forwardWompiToShopify, processWompiEvent } from "./handlers/processWompiEvent";
import { sendChatwootMessage } from "./handlers/sendChatwootMessage";
import { paymentRetry } from "./handlers/paymentRetry";
import { subscriptionReminder } from "./handlers/subscriptionReminder";
import { systemLog, SystemActor } from "../services/systemLog";
import { getAutoDebitConfig, getShopifyForward, getShopifyForwardRetryConfig } from "../services/runtimeConfig";
import { resolveEffectiveSubscriptionAutomationConfigById } from "../services/subscriptionAutomationConfig";
import { billingMonthlyReport } from "./handlers/billingMonthlyReport";
import { sendCampaign } from "./handlers/sendCampaign";
import { syncSmartLists } from "./handlers/syncSmartLists";
import { aiAssist } from "./handlers/aiAssist";
import { gamificationRecalc } from "./handlers/gamificationRecalc";
import { dataTrainer } from "./handlers/dataTrainer";
import { reconcileRecentChatwootDeliveries } from "../services/chatwootDelivery";
import { reconcileWompiByReference, reconcileWompiTransaction } from "../services/wompiReconcile";
import { resolveSubscriptionCollectionMode } from "../services/subscriptionMode";
import { ensurePaymentRetryJob, resolvePaymentRetryRunAt } from "../services/retryJobScheduler";
import { getZonedParts, applyClockTimeInZone } from "../lib/timeZoneScheduling";
import { handleSubscriptionPaymentFailure, ensureExpiredSubscriptions } from "../services/subscriptionBilling";
import { runWithActor } from "../services/actorStore";
import { publishRealtime } from "../services/realtimePublisher";
import { isBillingCyclePaid, resolveSubscriptionBillingState } from "../services/billingCycles";
import {
  forwardToShopifySchema,
  paymentRetrySchema,
  processWompiEventSchema
} from "../lib/job-payload-schemas";
import type {
  AiAssistPayload,
  BillingReportPayload,
  DataTrainerPayload,
  ForwardToShopifyPayload,
  GamificationRecalcPayload,
  PaymentRetryPayload,
  ProcessWompiEventPayload,
  SendCampaignPayload,
  SendChatwootMessagePayload,
  SubscriptionReminderPayload,
  SyncSmartListsPayload
} from "../types/job-payloads";

loadEnv(process.env);
const workerId = `jobs:${process.pid}`;
const workerHeartbeatKey = String(process.env.JOBS_HEARTBEAT_KEY || "wompi-subs-jobs").trim() || "wompi-subs-jobs";
let lastShopifyForwardRetryAt = 0;
let lastHeartbeatAtMs = 0;

const BOGOTA_TZ = "America/Bogota";
const MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE = Number(
  process.env.MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE ?? "2000"
);

function monthKeyUtc(y: number, m0: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

function computeNextMonthlyReportJob(nowMs: number) {
  // Use real timezone parts instead of a hardcoded UTC-5 offset
  const { year, month, day, hour, minute } = getZonedParts(new Date(nowMs), BOGOTA_TZ);
  // month is 1-indexed (1=Jan, 12=Dec)

  const isDay1Before005 = day === 1 && hour === 0 && minute < 5;
  const runYear = isDay1Before005 ? year : month === 12 ? year + 1 : year;
  const runMonth1 = isDay1Before005 ? month : month === 12 ? 1 : month + 1;

  // Schedule at 00:05 Bogotá on the 1st of the target month
  const firstOfMonth = new Date(Date.UTC(runYear, runMonth1 - 1, 1, 12, 0, 0));
  const runAt = applyClockTimeInZone(firstOfMonth, "00:05", BOGOTA_TZ);

  const prevMonth1 = runMonth1 === 1 ? 12 : runMonth1 - 1;
  const prevYear = runMonth1 === 1 ? runYear - 1 : runYear;
  const periodKey = monthKeyUtc(prevYear, prevMonth1 - 1);

  return { runAt, periodKey };
}

async function claimJobs(limit: number) {
  return prisma.$queryRaw<
    Array<{ id: string; type: RetryJobType; payload: any; attempts: number; maxAttempts: number }>
  >`
    WITH picked AS (
      SELECT id
      FROM "RetryJob"
      WHERE "status" = 'PENDING'::"RetryJobStatus"
        AND "runAt" <= now()
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "RetryJob" r
    SET "status" = 'RUNNING'::"RetryJobStatus", "lockedAt" = now(), "lockedBy" = ${workerId}, "updatedAt" = now()
    FROM picked
    WHERE r.id = picked.id
    RETURNING r.id, r.type, r.payload, r.attempts, r."maxAttempts";
  `;
}

function nextRunAt(attempts: number) {
  const baseMs = 5_000;
  const delayMs = Math.min(5 * 60_000, baseMs * Math.pow(2, Math.max(0, attempts)));
  return new Date(Date.now() + delayMs);
}

function nextRunAtMinutes(minutes: number) {
  const normalized = Number.isFinite(minutes) ? Math.max(1, Math.trunc(minutes)) : 60;
  return new Date(Date.now() + normalized * 60_000);
}

let lastEnsureAtMs = 0;
let lastEnsureSmartListsAtMs = 0;
let lastLogCleanupAtMs = 0;
let lastGamificationRecalcAtMs = 0;
let lastDataTrainerAtMs = 0;
let lastAutoReconcileAtMs = 0;
let lastWebhookRecoveryAtMs = 0;
let lastEnsureDueCutoffRetriesAtMs = 0;
let lastEnsurePaymentRetryQueueHealthAtMs = 0;
let lastChatwootDeliveryReconcileAtMs = 0;

function getRunnerErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function ensureMonthlyBillingReportJob() {
  const now = Date.now();
  if (now - lastEnsureAtMs < 60_000) return;
  lastEnsureAtMs = now;

  const next = computeNextMonthlyReportJob(now);

  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.BILLING_MONTHLY_REPORT,
      payload: { path: ["periodKey"], equals: next.periodKey } as any
    } as any
  });
  if (existing) return;

  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.BILLING_MONTHLY_REPORT,
        runAt: next.runAt,
        maxAttempts: 10,
        payload: { periodKey: next.periodKey }
      } as any
    })
    .catch((err) => {
      logger.warn({ err, periodKey: next.periodKey }, '[Jobs/Billing] Fallo creando job de reporte mensual');
    });
}

async function ensureSmartListsSyncJob() {
  const now = Date.now();
  const minutesRaw = Number(process.env.SMART_LISTS_SYNC_MINUTES || 15);
  const minutes = Number.isFinite(minutesRaw) ? Math.max(5, Math.trunc(minutesRaw)) : 15;
  if (now - lastEnsureSmartListsAtMs < minutes * 60_000) return;
  lastEnsureSmartListsAtMs = now;

  const recent = new Date(now - minutes * 60_000);
  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.SYNC_SMART_LISTS,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
      runAt: { gte: recent }
    }
  });
  if (existing) return;

  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.SYNC_SMART_LISTS,
        runAt: new Date(),
        maxAttempts: 5,
        payload: { reason: "auto" }
      } as any
    })
    .catch((err) => {
      logger.warn({ err }, '[Jobs/SmartLists] Fallo creando job de sincronización');
    });
}

async function ensureGamificationRecalcJob() {
  const now = Date.now();
  if (now - lastGamificationRecalcAtMs < 60 * 60 * 1000) return;
  lastGamificationRecalcAtMs = now;

  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.GAMIFICATION_RECALC,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] }
    }
  });
  if (existing) return;

  await prisma.retryJob.create({
    data: {
      type: RetryJobType.GAMIFICATION_RECALC,
      runAt: new Date(),
      maxAttempts: 3,
      payload: { reason: "auto" }
    }
  }).catch((err) => {
    logger.warn({ err }, '[Jobs/Gamification] Fallo creando job de recálculo');
  });
}

async function ensureDataTrainerJob() {
  const now = Date.now();
  if (now - lastDataTrainerAtMs < 4 * 60 * 60 * 1000) return;
  lastDataTrainerAtMs = now;

  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.DATA_TRAINER,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] }
    }
  });
  if (existing) return;

  await prisma.retryJob.create({
    data: {
      type: RetryJobType.DATA_TRAINER,
      runAt: new Date(),
      maxAttempts: 3,
      payload: { reason: "auto" }
    }
  }).catch((err) => {
    logger.warn({ err }, '[Jobs/DataTrainer] Fallo creando job de entrenamiento');
  });
}

async function ensureLogCleanup() {
  const now = Date.now();
  if (now - lastLogCleanupAtMs < 24 * 60 * 60 * 1000) return;
  lastLogCleanupAtMs = now;

  const days = Number(process.env.AUDIT_LOG_RETENTION_DAYS || process.env.LOG_RETENTION_DAYS || 60);
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
  await prisma.systemLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

async function ensureJobsHeartbeat() {
  const now = Date.now();
  if (now - lastHeartbeatAtMs < 60_000) return;
  lastHeartbeatAtMs = now;

  const heartbeatAt = new Date();
  const meta = { type: "jobs_runner", pid: process.pid };
  await Promise.all([
    prisma.serviceHeartbeat.upsert({
      where: { key: workerId },
      create: { key: workerId, lastSeenAt: heartbeatAt, meta },
      update: { lastSeenAt: heartbeatAt, meta }
    }),
    prisma.serviceHeartbeat.upsert({
      where: { key: workerHeartbeatKey },
      create: { key: workerHeartbeatKey, lastSeenAt: heartbeatAt, meta },
      update: { lastSeenAt: heartbeatAt, meta }
    })
  ]).catch((err) => {
    logger.warn({ err, workerId, workerHeartbeatKey }, '[Jobs/Heartbeat] Fallo actualizando heartbeat');
  });
}

async function ensurePendingPaymentsAutoReconcile() {
  const now = Date.now();
  if (now - lastAutoReconcileAtMs < 10 * 60 * 1000) return;
  lastAutoReconcileAtMs = now;

  const pending = await prisma.payment.findMany({
    where: { status: "PENDING", wompiTransactionId: { not: null }, createdAt: { lt: new Date(now - 15 * 60 * 1000) } },
    take: 50,
    orderBy: { createdAt: "asc" }
  });
  if (!pending.length) return;

  let reconciled = 0;
  let tried = 0;
  for (const p of pending) {
    tried++;
    try {
      const res = await reconcileWompiTransaction({ wompiTransactionId: String(p.wompiTransactionId || "") });
      if (res.status !== "PENDING") reconciled++;
    } catch (err) {
      logger.warn({ err, paymentId: p.id }, '[Jobs/Reconcile] Fallo en reconciliación automática');
    }
  }

  if (tried > 0) {
    await systemLog(LogLevel.INFO, "payments.reconcile.auto", "Auto reconcile run", { tried, reconciled }).catch((err) => {
      logger.warn({ err, tried, reconciled }, '[Jobs/Reconcile] Fallo creando systemLog');
    });
  }
}

async function ensureWompiWebhookRecoveryJobs() {
  const now = Date.now();
  if (now - lastWebhookRecoveryAtMs < 60 * 60 * 1000) return;
  lastWebhookRecoveryAtMs = now;

  const stale = await prisma.webhookEvent.findMany({
    where: {
      provider: WebhookProvider.WOMPI,
      processStatus: WebhookProcessStatus.RECEIVED,
      receivedAt: { lt: new Date(now - 30 * 60 * 1000) }
    },
    take: 100,
    select: { id: true }
  });
  if (!stale.length) return;

  const toEnqueue = [];
  for (const ev of stale) {
    const existing = await prisma.retryJob.findFirst({
      where: { type: RetryJobType.PROCESS_WOMPI_EVENT, payload: { path: ["webhookEventId"], equals: ev.id } as any }
    });
    if (!existing) toEnqueue.push(ev.id);
  }

  if (toEnqueue.length) {
    await prisma.retryJob.createMany({
      data: toEnqueue.map((id) => ({
        type: RetryJobType.PROCESS_WOMPI_EVENT,
        payload: { webhookEventId: id },
        runAt: new Date()
      })) as any
    });
    await systemLog(LogLevel.INFO, "payments.reconcile.webhooks", "Wompi webhook recovery queued", { count: toEnqueue.length }).catch((err) => {
      logger.warn({ err, queued: toEnqueue.length }, '[Jobs/WebhookRecovery] Fallo creando systemLog');
    });
  }
}

/**
 * FIX #1: Evita spam de payment links duplicados.
 * Si ya existe un payment link PENDIENTE reciente para esta suscripción,
 * no se crea otro job de reintento.
 */
async function hasRecentPendingPaymentLink(subscriptionId: string, windowMs: number): Promise<boolean> {
  const recent = await prisma.payment.findFirst({
    where: {
      subscriptionId,
      status: PaymentStatus.PENDING,
      origin: { in: ["AUTO_LINK", "MANUAL_LINK"] as any },
      createdAt: { gte: new Date(Date.now() - windowMs) }
    },
    select: { id: true }
  });
  return recent !== null;
}

async function ensureDueCutoffRetries() {
  const now = Date.now();
  // Correr con menos frecuencia (cada 30 min) ya que ahora es solo un respaldo
  if (now - lastEnsureDueCutoffRetriesAtMs < 30 * 60 * 1000) return;
  lastEnsureDueCutoffRetriesAtMs = now;

  const autoDebitConfig = await getAutoDebitConfig();
  const autoDebitEnabled = autoDebitConfig.enabled;
  const chargeAtCutoffEnabled = autoDebitConfig.chargeAtCutoffEnabled;

  // 1. Limpieza de duplicados (mantiene el más próximo a ejecutar)
  await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER(PARTITION BY (payload->>'subscriptionId') ORDER BY "runAt" ASC, "createdAt" ASC) as rn
      FROM "RetryJob"
      WHERE "type" = 'PAYMENT_RETRY'::"RetryJobType"
        AND "status" = 'PENDING'::"RetryJobStatus"
    )
    UPDATE "RetryJob" r
    SET "status" = 'CANCELED'::"RetryJobStatus",
        "lastError" = 'dedupe_payment_retry_same_subscription',
        "updatedAt" = NOW(),
        "lockedAt" = NULL,
        "lockedBy" = NULL
    FROM ranked k
    WHERE r.id = k.id
      AND k.rn > 1
  `);

  // 2. FIX #2: Paginación con cursor para procesar TODAS las suscripciones (no solo 1000).
  // Sincronización de Seguridad: Solo crea el Job si NO existe uno activo.
  // Esto asegura que ninguna suscripción se quede sin su "despertador".
  const PAGE_SIZE = 500;
  let processedTotal = 0;
  let createdJobs = 0;
  let skippedRecentLink = 0;
  let skippedExhausted = 0;
  let cursor: string | undefined;

  do {
    const subs = await prisma.subscription.findMany({
      where: { status: { in: ["ACTIVE", "PAST_DUE"] as any } },
      select: {
        id: true,
        status: true,
        metadata: true,
        plan: { select: { metadata: true } }
      },
      take: PAGE_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: "asc" }
    });

    if (!subs.length) break;
    processedTotal += subs.length;

    const nowDate = new Date();
    const futureToleranceMs = 5_000;

    for (const sub of subs) {
      const mode = resolveSubscriptionCollectionMode(sub);
      if (mode !== "AUTO_DEBIT" && mode !== "AUTO_LINK") continue;

      // Si es AUTO_DEBIT y el cobro en corte está apagado, omitir creación de Job.
      if (mode === "AUTO_DEBIT" && (!autoDebitEnabled || !chargeAtCutoffEnabled)) continue;

      // FIX #1: Si ya hay un payment link pendiente reciente, saltar para evitar spam.
      // Ventana de 2 horas: si se creó un link en las últimas 2h, no crear otro.
      const hasRecent = await hasRecentPendingPaymentLink(sub.id, 2 * 60 * 60 * 1000);
      if (hasRecent) {
        skippedRecentLink++;
        continue;
      }

      const billingState = await resolveSubscriptionBillingState({ subscriptionId: sub.id });
      const collectionCycle = billingState?.collectionCycle || null;
      const collectionCyclePaid = isBillingCyclePaid(collectionCycle);
      if (!collectionCycle || collectionCyclePaid) continue;

      // El tope de intentos vale con o sin reintentos activos: antes, con los
      // reintentos encendidos, esta sincronización volvía a agendar cobro para
      // el mismo ciclo en cada pasada, sin techo.
      const intentosCiclo = await hasExhaustedCycleAttempts({
        subscriptionId: sub.id,
        cycleNumber: collectionCycle.cycleNumber,
        config: autoDebitConfig
      }).catch(() => ({ exhausted: false, attempts: 0, allowed: 1 }));
      if (intentosCiclo.exhausted) {
        skippedExhausted++;
        continue;
      }

      if (!autoDebitConfig.retryEnabled) {
        const existingCyclePayment = await prisma.payment.findFirst({
          where: {
            subscriptionId: sub.id,
            status: {
              in: [
                PaymentStatus.PENDING,
                PaymentStatus.DECLINED,
                PaymentStatus.ERROR,
                PaymentStatus.VOIDED,
                PaymentStatus.APPROVED
              ]
            },
            OR: [
              { cycleNumber: collectionCycle.cycleNumber },
              { subscriptionCycleKey: `${sub.id}:${collectionCycle.cycleNumber}` },
              { reference: { startsWith: `SUB_${sub.id}_${collectionCycle.cycleNumber}` } }
            ]
          },
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            status: true,
            reference: true,
            wompiTransactionId: true,
            createdAt: true
          }
        });
        if (existingCyclePayment) {
          continue;
        }
      }

      const dueAt = collectionCycle ? new Date(collectionCycle.dueAt || collectionCycle.periodEndAt) : null;
      const runAt = dueAt
        ? await resolvePaymentRetryRunAt({
            dueAt,
            now: nowDate,
            config: autoDebitConfig
          })
        : nowDate;

      // ensurePaymentRetryJob internamente revisa si ya existe uno pendiente.
      const job = await ensurePaymentRetryJob({ subscriptionId: sub.id, runAt, maxAttempts: 1 }).catch((err) => {
        logger.warn({ err, subscriptionId: sub.id }, '[Jobs/SafetySync] Fallo en sincronización de seguridad');
        return null;
      });

      // Actualizar metadata para que sea visible en el UI
      if (job) {
        createdJobs++;
        const currentMetadata = (sub.metadata as Record<string, any>) || {};
        const newMetadata = {
          ...currentMetadata,
          autoRetry: {
            nextRetryAt: runAt.toISOString(),
            scheduledAt: new Date().toISOString(),
            source: "ensureDueCutoffRetries",
            runAt: runAt.toISOString()
          }
        };

        await prisma.subscription.update({
          where: { id: sub.id },
          data: { metadata: newMetadata }
        }).catch((err) => {
          logger.warn({ err, subscriptionId: sub.id }, '[Jobs/SafetySync] Fallo al actualizar metadata de reintento');
        });
      }
    }

    if (processedTotal >= MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE) {
      logger.info(
        { processedTotal, limit: MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE },
        "[Jobs/SafetySync] Límite de suscripciones por ciclo alcanzado, continuará en el siguiente ciclo"
      );
      break;
    }

    // Avanzar cursor
    cursor = subs[subs.length - 1].id;

    // Si recibimos menos de PAGE_SIZE, ya no hay más
    if (subs.length < PAGE_SIZE) break;
  } while (true);

  // Log de resumen para observabilidad
  if (processedTotal > 0) {
    await systemLog(LogLevel.INFO, "jobs.safety_sync", "Due cutoff retries processed", {
      processedSubscriptions: processedTotal,
      jobsCreated: createdJobs,
      jobsSkippedRecentLink: skippedRecentLink,
      jobsSkippedAttemptsExhausted: skippedExhausted
    }).catch((err) => {
      logger.warn({ err }, '[Jobs/SafetySync] Fallo creando resumen de seguridad');
    });
  }
}

async function ensurePaymentRetryQueueHealth() {
  const now = Date.now();
  if (now - lastEnsurePaymentRetryQueueHealthAtMs < 60 * 60 * 1000) return;
  lastEnsurePaymentRetryQueueHealthAtMs = now;

  const stale = await prisma.retryJob.findMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.RUNNING,
      lockedAt: { lt: new Date(now - 10 * 60 * 1000) }
    },
    take: 100
  });
  for (const job of stale) {
    const cfg = await getAutoDebitConfig().catch(() => null);
    const retryDelayMinutes = Math.max(1, Number(cfg?.retryEveryMinutes || 30));
    await prisma.retryJob.update({
      where: { id: job.id },
      data: {
        status: RetryJobStatus.PENDING,
        runAt: new Date(now + retryDelayMinutes * 60_000),
        lockedAt: null,
        lockedBy: null,
        attempts: { increment: 1 }
      }
    }).catch((err) => {
      logger.warn({ err, jobId: job.id }, "[Jobs/Health] Fallo reencolando retry job estancado");
    });
  }
}

async function ensureChatwootDeliveryReconcile() {
  const now = Date.now();
  if (now - lastChatwootDeliveryReconcileAtMs < 60_000) return;
  lastChatwootDeliveryReconcileAtMs = now;

  const result = await reconcileRecentChatwootDeliveries({ windowMinutes: 30, limit: 50 }).catch((err) => {
    logger.warn({ err }, "[Jobs/Chatwoot] Fallo reconciliando estados de entrega");
    return null;
  });
  if (result && result.checked > 0) {
    await systemLog(LogLevel.INFO, "chatwoot.delivery", "Chatwoot delivery reconcile run", result).catch((err) => {
      logger.warn({ err, result }, "[Jobs/Chatwoot] Fallo creando systemLog de reconciliación");
    });
  }
}

async function ensureShopifyForwardRetries() {
  const now = Date.now();
  const { enabled, minutes } = await getShopifyForwardRetryConfig();
  if (!enabled) return;
  if (now - lastShopifyForwardRetryAt < minutes * 60 * 1000) return;

  const cfg = await getShopifyForward();
  if (!cfg.url) return;

  lastShopifyForwardRetryAt = now;
  const result = await prisma.retryJob.updateMany({
    where: {
      status: RetryJobStatus.FAILED,
      type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
      attempts: { lt: 3 }
    },
    data: { status: RetryJobStatus.PENDING, runAt: new Date(), lockedAt: null, lockedBy: null }
  });
  if (result.count) {
    logger.info({ retried: result.count }, "Shopify forward retries enqueued");
  }
}

function getActorForJobType(type: RetryJobType): string {
  if (type === RetryJobType.PROCESS_WOMPI_EVENT) return SystemActor.JOB_PROCESS_WOMPI;
  if (type === RetryJobType.PAYMENT_RETRY) return SystemActor.JOB_PAYMENT_RETRY;
  if (type === RetryJobType.SUBSCRIPTION_REMINDER) return SystemActor.JOB_SUBSCRIPTION_REMINDER;
  if (type === RetryJobType.SEND_CHATWOOT_MESSAGE) return SystemActor.JOB_SEND_CHATWOOT;
  return `job:${type}`;
}

async function runOnce() {
  const jobs = await claimJobs(10);
  for (const job of jobs) {
    const actor = getActorForJobType(job.type);
    await runWithActor(actor, async () => {
      try {
        let paymentRetryOutcome:
          | { status: "processed" | "deferred" | "skipped"; reason?: string; nextRunAt?: Date; action?: string }
          | null = null;

        if (job.type === RetryJobType.PROCESS_WOMPI_EVENT) {
          const parsed = processWompiEventSchema.safeParse(job.payload);
          if (!parsed.success) {
            logger.warn({ jobId: job.id, errors: parsed.error.flatten() }, "job payload inválido");
            await prisma.retryJob.update({
              where: { id: job.id },
              data: {
                status: RetryJobStatus.FAILED,
                lastError: "invalid_payload",
                lockedAt: null,
                lockedBy: null
              }
            });
            return;
          }
          const p: ProcessWompiEventPayload = parsed.data;
          await processWompiEvent(p.webhookEventId);
        } else if (job.type === RetryJobType.FORWARD_WOMPI_TO_SHOPIFY) {
          const parsed = forwardToShopifySchema.safeParse(job.payload);
          if (!parsed.success) {
            logger.warn({ jobId: job.id, errors: parsed.error.flatten() }, "job payload inválido");
            await prisma.retryJob.update({
              where: { id: job.id },
              data: {
                status: RetryJobStatus.FAILED,
                lastError: "invalid_payload",
                lockedAt: null,
                lockedBy: null
              }
            });
            return;
          }
          const p: ForwardToShopifyPayload = parsed.data;
          await forwardWompiToShopify(p.webhookEventId);
        } else if (job.type === RetryJobType.SEND_CHATWOOT_MESSAGE) {
          const p = job.payload as SendChatwootMessagePayload;
          await sendChatwootMessage(p.chatwootMessageId);
        } else if (job.type === RetryJobType.PAYMENT_RETRY) {
          const parsed = paymentRetrySchema.safeParse(job.payload);
          if (!parsed.success) {
            logger.warn({ jobId: job.id, errors: parsed.error.flatten() }, "job payload inválido");
            await prisma.retryJob.update({
              where: { id: job.id },
              data: {
                status: RetryJobStatus.FAILED,
                lastError: "invalid_payload",
                lockedAt: null,
                lockedBy: null
              }
            });
            return;
          }
          const p: PaymentRetryPayload = parsed.data;
          paymentRetryOutcome = await paymentRetry(p);
        } else if (job.type === RetryJobType.SUBSCRIPTION_REMINDER) {
          const p = job.payload as SubscriptionReminderPayload;
          await subscriptionReminder(p);
        } else if (job.type === RetryJobType.BILLING_MONTHLY_REPORT) {
          const p = job.payload as BillingReportPayload;
          await billingMonthlyReport(p);
        } else if (job.type === RetryJobType.SEND_CAMPAIGN) {
          const p = job.payload as SendCampaignPayload;
          if (!p.campaignId) throw new Error("campaign_id_missing");
          await sendCampaign(p as { campaignId: string });
        } else if (job.type === RetryJobType.SYNC_SMART_LISTS) {
          const _p = job.payload as SyncSmartListsPayload;
          await syncSmartLists();
        } else if (job.type === RetryJobType.AI_ASSIST) {
          const p = job.payload as AiAssistPayload;
          await aiAssist(p);
        } else if (job.type === RetryJobType.GAMIFICATION_RECALC) {
          const p = job.payload as GamificationRecalcPayload;
          await gamificationRecalc(p);
        } else if (job.type === RetryJobType.DATA_TRAINER) {
          const p = job.payload as DataTrainerPayload;
          await dataTrainer(p);
        } else {
          logger.warn({ jobId: job.id, type: job.type }, "Unhandled job type");
        }

        if (job.type === RetryJobType.PAYMENT_RETRY && paymentRetryOutcome?.status === "deferred") {
          await prisma.retryJob.update({
            where: { id: job.id },
            data: {
              status: RetryJobStatus.PENDING,
              runAt: paymentRetryOutcome.nextRunAt || nextRunAtMinutes(30),
              lastError: paymentRetryOutcome.reason || "retry_deferred",
              lockedAt: null,
              lockedBy: null
            }
          });
          return;
        }

        await prisma.retryJob.update({
          where: { id: job.id },
          data: {
            status: RetryJobStatus.SUCCEEDED,
            lastError: job.type === RetryJobType.PAYMENT_RETRY ? (paymentRetryOutcome?.reason || null) : null,
            lockedAt: null,
            lockedBy: null
          }
        });
        void publishRealtime("jobs", {
          jobId: job.id,
          type: job.type,
          status: "SUCCEEDED",
          attempts: job.attempts + 1,
          updatedAt: new Date().toISOString()
        });
      } catch (err) {
        const errMsg = getRunnerErrorMessage(err);
        if (
          job.type === RetryJobType.PAYMENT_RETRY &&
          (
            errMsg === "subscription_canceled" ||
            errMsg === "subscription_suspended" ||
            errMsg === "subscription_not_found" ||
            errMsg === "auto_debit_not_allowed_for_collection_mode" ||
            errMsg === "wompi_reference_already_used_guard" ||
            errMsg === "payment_already_approved"
          )
        ) {
          await prisma.retryJob.update({
            where: { id: job.id },
            data: {
              status: RetryJobStatus.SUCCEEDED,
              attempts: job.attempts + 1,
              lastError: errMsg,
              lockedAt: null,
              lockedBy: null
            }
          });
          await systemLog(LogLevel.INFO, "jobs.runner", "Cobro automático omitido", {
            jobId: job.id,
            type: job.type,
            reason: errMsg
          }).catch((logErr) => {
            logger.warn({ logErr, jobId: job.id }, '[Jobs/Runner] Fallo creando systemLog');
          });
          return;
        }
        const attempts = job.attempts + 1;
        let status: RetryJobStatus = attempts >= job.maxAttempts ? RetryJobStatus.FAILED : RetryJobStatus.PENDING;
        let runAt: Date | undefined = status === RetryJobStatus.PENDING ? nextRunAt(attempts) : undefined;
        if (job.type === RetryJobType.PAYMENT_RETRY) {
          const subId = (job.payload as PaymentRetryPayload | null | undefined)?.subscriptionId;
          const cfg = subId
            ? await resolveEffectiveSubscriptionAutomationConfigById(subId).catch(() => getAutoDebitConfig())
            : await getAutoDebitConfig();
          const canRetry = Boolean(cfg.retryEnabled) && attempts <= cfg.maxRetries;
          status = canRetry ? RetryJobStatus.PENDING : RetryJobStatus.FAILED;
          runAt = canRetry ? nextRunAtMinutes(cfg.retryEveryMinutes) : undefined;

          if (subId && status === RetryJobStatus.FAILED) {
            await handleSubscriptionPaymentFailure(subId, errMsg).catch((err) => {
              logger.warn({ err, subscriptionId: subId }, '[Jobs/Runner] Fallo manejando pago fallido');
            });
          }
        }
        await prisma.retryJob.update({
          where: { id: job.id },
          data: {
            status,
            attempts,
            lastError: errMsg,
            runAt,
            lockedAt: null,
            lockedBy: null
          }
        });
        logger.error({ jobId: job.id, err }, "Job failed");
        await systemLog(LogLevel.ERROR, "jobs.runner", "Job failed", {
          jobId: job.id,
          type: job.type,
          attempts,
          err: errMsg
        }).catch(
          () => {}
        );
        void publishRealtime("jobs", {
          jobId: job.id,
          type: job.type,
          status: status === RetryJobStatus.FAILED ? "FAILED" : "PENDING",
          attempts,
          err: errMsg,
          updatedAt: new Date().toISOString()
        });
      }
    });
  }
}

async function main() {
  logger.info({ workerId }, "Jobs runner started");
  while (true) {
    try {
      await ensureMonthlyBillingReportJob();
      await ensureSmartListsSyncJob();
      await ensureGamificationRecalcJob();
      await ensureDataTrainerJob();
      await ensureLogCleanup();
      await ensureShopifyForwardRetries();
      await ensureJobsHeartbeat();
      await ensurePendingPaymentsAutoReconcile();
      await ensureWompiWebhookRecoveryJobs();
      await ensureDueCutoffRetries();
      await ensurePaymentRetryQueueHealth();
      await ensureChatwootDeliveryReconcile();
      await ensureExpiredSubscriptions();
      await runOnce();
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      const msg =
        err && typeof err === "object" && "meta" in err && err.meta && typeof err.meta === "object" && "message" in err.meta
          ? String((err.meta as { message?: unknown }).message || "")
          : getRunnerErrorMessage(err);
      logger.warn({ err: msg }, "Jobs runner transient failure; retrying soon");
      const short = String(msg || "").replace(/\s+/g, " ").trim().slice(0, 240);
      const lower = String(msg || "").toLowerCase();
      const isDbSlots = lower.includes("remaining connection slots are reserved");
      const hint = isDbSlots
        ? "Base de datos sin cupos de conexión. Reduce conexiones/pool del API and worker, o aumenta límites en la BD."
        : "Falla transitoria en jobs. Revisa logs y estado de base de datos/credenciales.";
      await systemLog(
        LogLevel.WARN,
        "jobs.runner",
        short ? `Transient failure (will retry): ${short}` : "Transient failure (will retry)",
        {
          err: msg,
          reasonCode: isDbSlots ? "db_connection_slots_exhausted" : "transient_jobs_failure",
          actionHint: hint
        }
      ).catch((logErr) => {
        logger.warn({ logErr, err: msg }, '[Jobs/Runner] Fallo creando systemLog de error');
      });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Jobs runner crashed");
  process.exit(1);
});
