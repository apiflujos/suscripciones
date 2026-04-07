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
import { billingMonthlyReport } from "./handlers/billingMonthlyReport";
import { sendCampaign } from "./handlers/sendCampaign";
import { syncSmartLists } from "./handlers/syncSmartLists";
import { aiAssist } from "./handlers/aiAssist";
import { gamificationRecalc } from "./handlers/gamificationRecalc";
import { dataTrainer } from "./handlers/dataTrainer";
import { reconcileWompiByReference, reconcileWompiTransaction } from "../services/wompiReconcile";
import { resolveSubscriptionCollectionMode } from "../services/subscriptionMode";
import { ensurePaymentRetryJob } from "../services/retryJobScheduler";
import { handleSubscriptionPaymentFailure, ensureExpiredSubscriptions } from "../services/subscriptionBilling";
import { runWithActor } from "../services/actorStore";
import { publishRealtime } from "../services/realtimePublisher";
import { computeBillingCycleDueAt } from "../services/billingCycles";

loadEnv(process.env);
const workerId = `jobs:${process.pid}`;
const workerHeartbeatKey = String(process.env.JOBS_HEARTBEAT_KEY || "wompi-subs-jobs").trim() || "wompi-subs-jobs";
let lastShopifyForwardRetryAt = 0;
let lastHeartbeatAtMs = 0;

const BOGOTA_UTC_OFFSET_MS = -5 * 60 * 60 * 1000;

function monthKeyUtc(y: number, m0: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

function computeNextMonthlyReportJob(nowMs: number) {
  const bogotaNow = new Date(nowMs + BOGOTA_UTC_OFFSET_MS);
  const y = bogotaNow.getUTCFullYear();
  const m = bogotaNow.getUTCMonth();
  const d = bogotaNow.getUTCDate();
  const hh = bogotaNow.getUTCHours();
  const mm = bogotaNow.getUTCMinutes();

  const isDay1Before005 = d === 1 && hh === 0 && mm < 5;
  const runY = isDay1Before005 ? y : m === 11 ? y + 1 : y;
  const runM = isDay1Before005 ? m : (m + 1) % 12;
  const runAt = new Date(Date.UTC(runY, runM, 1, 5, 5, 0, 0)); // 00:05 Bogotá = 05:05 UTC

  const prevM = runM === 0 ? 11 : runM - 1;
  const prevY = runM === 0 ? runY - 1 : runY;
  const periodKey = monthKeyUtc(prevY, prevM);

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
  }).catch((err: any) => {
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
  }).catch((err: any) => {
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
  ]).catch((err: any) => {
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

async function ensureDueCutoffRetries() {
  const now = Date.now();
  // Correr con menos frecuencia (cada 30 min) ya que ahora es solo un respaldo
  if (now - lastEnsureDueCutoffRetriesAtMs < 30 * 60 * 1000) return;
  lastEnsureDueCutoffRetriesAtMs = now;

  const autoDebitConfig = await getAutoDebitConfig();
  const chargeAtCutoffEnabled = autoDebitConfig.chargeAtCutoffEnabled;

  // 1. Limpieza de duplicados (mantiene el más reciente)
  await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER(PARTITION BY (payload->>'subscriptionId') ORDER BY "runAt" DESC) as rn
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

  // 2. Sincronización de Seguridad: Solo crea el Job si NO existe uno activo.
  // Esto asegura que ninguna suscripción se quede sin su "despertador".
  const subs = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "PAST_DUE"] as any } },
    select: {
      id: true,
      status: true,
      currentPeriodEndAt: true,
      currentPeriodStartAt: true,
      cycleStartDay: true,
      paymentDay: true,
      paymentTiming: true,
      metadata: true,
      plan: { select: { metadata: true, intervalUnit: true } }
    },
    take: 1000
  });
  if (!subs.length) return;

  const nowDate = new Date();
  const futureToleranceMs = 5_000;
  for (const sub of subs) {
    const mode = resolveSubscriptionCollectionMode(sub);
    if (mode !== "AUTO_DEBIT" && mode !== "AUTO_LINK") continue;

    // Si es AUTO_DEBIT y el cobro en corte está apagado, omitir creación de Job.
    if (mode === "AUTO_DEBIT" && !chargeAtCutoffEnabled) continue;

    const dueAt =
      String(sub.plan?.intervalUnit || "MONTH").toUpperCase() === "MONTH" &&
      sub.currentPeriodStartAt &&
      sub.currentPeriodEndAt
        ? computeBillingCycleDueAt({
            periodStartAt: sub.currentPeriodStartAt,
            periodEndAt: sub.currentPeriodEndAt,
            cycleStartDay: sub.cycleStartDay,
            paymentDay: sub.paymentDay,
            paymentTiming: (sub.paymentTiming as any) === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
          })
        : sub.currentPeriodEndAt;
    const runAtMs = dueAt?.getTime?.() ?? 0;
    const runAt = runAtMs > now + futureToleranceMs ? new Date(runAtMs) : nowDate;

    // ensurePaymentRetryJob internamente revisa si ya existe uno pendiente.
    const job = await ensurePaymentRetryJob({ subscriptionId: sub.id, runAt, maxAttempts: 1 }).catch((err) => {
      logger.warn({ err, subscriptionId: sub.id }, '[Jobs/SafetySync] Fallo en sincronización de seguridad');
      return null;
    });

    // Actualizar metadata para que sea visible en el UI
    if (job) {
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
    await prisma.retryJob.update({
      where: { id: job.id },
      data: { status: RetryJobStatus.PENDING, lockedAt: null, lockedBy: null, attempts: { increment: 1 } }
    }).catch((err) => {
      logger.warn({ err, jobId: job.id }, "[Jobs/Health] Fallo reencolando retry job estancado");
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
        const payload = job.payload as any;
        let paymentRetryOutcome:
          | { status: "processed" | "deferred" | "skipped"; reason?: string; nextRunAt?: Date; action?: string }
          | null = null;

        if (job.type === RetryJobType.PROCESS_WOMPI_EVENT) {
          await processWompiEvent(payload.webhookEventId);
        } else if (job.type === RetryJobType.FORWARD_WOMPI_TO_SHOPIFY) {
          await forwardWompiToShopify(payload.webhookEventId);
        } else if (job.type === RetryJobType.SEND_CHATWOOT_MESSAGE) {
          await sendChatwootMessage(payload.chatwootMessageId);
        } else if (job.type === RetryJobType.PAYMENT_RETRY) {
          paymentRetryOutcome = await paymentRetry(payload);
        } else if (job.type === RetryJobType.SUBSCRIPTION_REMINDER) {
          await subscriptionReminder(payload);
        } else if (job.type === RetryJobType.BILLING_MONTHLY_REPORT) {
          await billingMonthlyReport(payload);
        } else if (job.type === RetryJobType.SEND_CAMPAIGN) {
          await sendCampaign(payload);
        } else if (job.type === RetryJobType.SYNC_SMART_LISTS) {
          await syncSmartLists();
        } else if (job.type === RetryJobType.AI_ASSIST) {
          await aiAssist(payload);
        } else if (job.type === RetryJobType.GAMIFICATION_RECALC) {
          await gamificationRecalc(payload);
        } else if (job.type === RetryJobType.DATA_TRAINER) {
          await dataTrainer(payload);
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
      } catch (err: any) {
        const errMsg = err?.message ? String(err.message) : "unknown error";
        if (
          job.type === RetryJobType.PAYMENT_RETRY &&
          (
            errMsg === "subscription_canceled" ||
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
          const cfg = await getAutoDebitConfig();
          const canRetry = cfg.retryEnabled && attempts <= cfg.maxRetries;
          status = canRetry ? RetryJobStatus.PENDING : RetryJobStatus.FAILED;
          runAt = canRetry ? nextRunAtMinutes(cfg.retryEveryMinutes) : undefined;
          
          if (status === RetryJobStatus.FAILED) {
            const subId = (job.payload as any)?.subscriptionId;
            if (subId) {
              await handleSubscriptionPaymentFailure(subId, errMsg).catch((err) => {
                logger.warn({ err, subscriptionId: subId }, '[Jobs/Runner] Fallo manejando pago fallido');
              });
            }
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
      await ensureExpiredSubscriptions();
      await runOnce();
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err: any) {
      const msg = err?.meta?.message || err?.message || String(err);
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
