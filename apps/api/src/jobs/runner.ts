import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { loadEnv } from "../config/env";
import { LogLevel, PaymentStatus, RetryJobStatus, RetryJobType, WebhookProcessStatus, WebhookProvider } from "@prisma/client";
import { forwardWompiToShopify, processWompiEvent } from "./handlers/processWompiEvent";
import { sendChatwootMessage } from "./handlers/sendChatwootMessage";
import { paymentRetry } from "./handlers/paymentRetry";
import { subscriptionReminder } from "./handlers/subscriptionReminder";
import { systemLog } from "../services/systemLog";
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

loadEnv(process.env);
const workerId = `jobs:${process.pid}`;
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

async function ensureLogCleanup() {
  const now = Date.now();
  if (now - lastLogCleanupAtMs < 6 * 60 * 60 * 1000) return;
  lastLogCleanupAtMs = now;
  const daysRaw = Number(process.env.SYSTEM_LOG_RETENTION_DAYS || 30);
  const days = Number.isFinite(daysRaw) ? Math.max(7, Math.trunc(daysRaw)) : 30;
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
  await prisma.systemLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

async function ensureGamificationRecalcJob() {
  const now = Date.now();
  const minutesRaw = Number(process.env.GAMIFICATION_RECALC_MINUTES || 60);
  const minutes = Number.isFinite(minutesRaw) ? Math.max(15, Math.trunc(minutesRaw)) : 60;
  if (now - lastGamificationRecalcAtMs < minutes * 60_000) return;
  lastGamificationRecalcAtMs = now;

  const recent = new Date(now - minutes * 60_000);
  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.GAMIFICATION_RECALC,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
      runAt: { gte: recent }
    }
  });
  if (existing) return;

  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.GAMIFICATION_RECALC,
        runAt: new Date(),
        maxAttempts: 3,
        payload: { scope: "all", reason: "auto" }
      } as any
    })
    .catch((err) => {
      logger.warn({ err }, '[Jobs/Gamification] Fallo creando job de recálculo');
    });
}

async function ensureDataTrainerJob() {
  const now = Date.now();
  const minutesRaw = Number(process.env.DATA_TRAINER_MINUTES || 15);
  const minutes = Number.isFinite(minutesRaw) ? Math.max(5, Math.trunc(minutesRaw)) : 15;
  if (now - lastDataTrainerAtMs < minutes * 60_000) return;
  lastDataTrainerAtMs = now;

  const recent = new Date(now - minutes * 60_000);
  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.DATA_TRAINER,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
      runAt: { gte: recent }
    }
  });
  if (existing) return;

  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.DATA_TRAINER,
        runAt: new Date(),
        maxAttempts: 2,
        payload: { trainer: "chatwoot_followup" }
      } as any
    })
    .catch((err) => {
      logger.warn({ err }, '[Jobs/DataTrainer] Fallo creando job de entrenamiento');
    });
}

async function ensureJobsHeartbeat() {
  const now = Date.now();
  const secondsRaw = Number(process.env.JOBS_HEARTBEAT_SECONDS || 60);
  const intervalMs = Number.isFinite(secondsRaw) ? Math.max(15, Math.trunc(secondsRaw)) * 1000 : 60_000;
  if (now - lastHeartbeatAtMs < intervalMs) return;
  lastHeartbeatAtMs = now;
  const key = String(process.env.JOBS_HEARTBEAT_KEY || "wompi-subs-jobs").trim() || "wompi-subs-jobs";
  await prisma.serviceHeartbeat
    .upsert({
      where: { key },
      create: { key, lastSeenAt: new Date(now), meta: { workerId } } as any,
      update: { lastSeenAt: new Date(now), meta: { workerId } } as any
    })
    .catch((err) => {
      logger.warn({ err, key }, '[Jobs/Heartbeat] Fallo actualizando heartbeat');
    });
}

async function ensurePendingPaymentsAutoReconcile() {
  const now = Date.now();
  const intervalSecondsRaw = Number(process.env.PAYMENT_RECONCILE_INTERVAL_SECONDS || 120);
  const intervalMs = (Number.isFinite(intervalSecondsRaw) ? Math.max(30, Math.trunc(intervalSecondsRaw)) : 120) * 1000;
  if (now - lastAutoReconcileAtMs < intervalMs) return;
  lastAutoReconcileAtMs = now;

  const minAgeSecondsRaw = Number(process.env.PAYMENT_RECONCILE_MIN_AGE_SECONDS || 90);
  const minAgeSeconds = Number.isFinite(minAgeSecondsRaw) ? Math.max(30, Math.trunc(minAgeSecondsRaw)) : 90;
  const limitRaw = Number(process.env.PAYMENT_RECONCILE_BATCH || 25);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 25;
  const maxAttemptsRaw = Number(process.env.PAYMENT_RECONCILE_MAX_ATTEMPTS || 8);
  const maxAttempts = Number.isFinite(maxAttemptsRaw) ? Math.min(Math.max(Math.trunc(maxAttemptsRaw), 1), 20) : 8;
  const cooldownMinutesRaw = Number(process.env.PAYMENT_RECONCILE_COOLDOWN_MINUTES || 10);
  const cooldownMs = (Number.isFinite(cooldownMinutesRaw) ? Math.max(1, Math.trunc(cooldownMinutesRaw)) : 10) * 60 * 1000;

  const olderThan = new Date(now - minAgeSeconds * 1000);
  const payments = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.PENDING,
      OR: [{ wompiTransactionId: { not: null } }, { reference: { not: "" } }],
      createdAt: { lt: olderThan }
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      tenantId: true,
      reference: true,
      wompiPaymentLinkId: true,
      wompiTransactionId: true,
      amountInCents: true,
      currency: true,
      providerResponse: true
    }
  });
  if (!payments.length) return;

  let reconciled = 0;
  let tried = 0;
  for (const payment of payments) {
    const tx = String(payment.wompiTransactionId || "").trim();
    const reference = String(payment.reference || "").trim();
    if (!tx && !reference) continue;
    const provider = payment.providerResponse && typeof payment.providerResponse === "object" ? (payment.providerResponse as any) : {};
    const autoMeta = provider?.autoReconcile && typeof provider.autoReconcile === "object" ? provider.autoReconcile : {};
    const attempts = Number(autoMeta.attempts || 0);
    const lastAt = autoMeta.lastAt ? new Date(String(autoMeta.lastAt)).getTime() : 0;
    if (attempts >= maxAttempts) continue;
    if (Number.isFinite(lastAt) && lastAt > 0 && now - lastAt < cooldownMs) continue;

    tried += 1;
    try {
      const out = tx
        ? await reconcileWompiTransaction({
            wompiTransactionId: tx,
            tenantId: payment.tenantId || undefined,
            checksumPrefix: "jobs-auto-reconcile"
          })
        : await reconcileWompiByReference({
            reference,
            tenantId: payment.tenantId || undefined,
            paymentLinkId: payment.wompiPaymentLinkId || undefined,
            amountInCents: Number(payment.amountInCents || 0),
            currency: payment.currency || undefined,
            checksumPrefix: "jobs-auto-reconcile-ref"
          });
      if (out?.ok) reconciled += 1;
      const nextProvider = {
        ...provider,
        autoReconcile: {
          attempts: attempts + 1,
          lastAt: new Date().toISOString(),
          ok: Boolean(out?.ok),
          reason: (out as any)?.reason || null
        }
      };
      await prisma.payment.update({
        where: { id: payment.id },
        data: { providerResponse: nextProvider as any }
      });
    } catch (err: any) {
      const nextProvider = {
        ...provider,
        autoReconcile: {
          attempts: attempts + 1,
          lastAt: new Date().toISOString(),
          ok: false,
          reason: String(err?.message || "reconcile_failed")
        }
      };
      await prisma.payment.update({
        where: { id: payment.id },
        data: { providerResponse: nextProvider as any }
      });
    }
  }

  if (tried > 0) {
    await systemLog(LogLevel.INFO, "payments.reconcile.auto", "Auto reconcile run", {
      scanned: payments.length,
      tried,
      reconciled,
      maxAttempts,
      cooldownMinutes: Math.round(cooldownMs / 60000)
    }).catch((err) => {
      logger.warn({ err, tried, reconciled }, '[Jobs/Reconcile] Fallo creando systemLog');
    });
  }
}

async function ensureWompiWebhookRecoveryJobs() {
  const now = Date.now();
  const intervalSecondsRaw = Number(process.env.WEBHOOK_RECOVERY_INTERVAL_SECONDS || 60);
  const intervalMs = (Number.isFinite(intervalSecondsRaw) ? Math.max(30, Math.trunc(intervalSecondsRaw)) : 60) * 1000;
  if (now - lastWebhookRecoveryAtMs < intervalMs) return;
  lastWebhookRecoveryAtMs = now;

  const lookbackMinutesRaw = Number(process.env.WEBHOOK_RECOVERY_LOOKBACK_MINUTES || 240);
  const lookbackMinutes = Number.isFinite(lookbackMinutesRaw) ? Math.max(30, Math.trunc(lookbackMinutesRaw)) : 240;
  const limitRaw = Number(process.env.WEBHOOK_RECOVERY_BATCH || 120);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 10), 500) : 120;
  const since = new Date(now - lookbackMinutes * 60 * 1000);

  const stuck = await prisma.webhookEvent.findMany({
    where: {
      provider: WebhookProvider.WOMPI,
      processStatus: { in: [WebhookProcessStatus.RECEIVED, WebhookProcessStatus.FAILED] },
      receivedAt: { gte: since }
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true }
  });
  if (!stuck.length) return;

  const ids = stuck.map((e) => String(e.id || "")).filter(Boolean);
  if (!ids.length) return;

  const pendingJobs = await prisma.retryJob.findMany({
    where: {
      type: RetryJobType.PROCESS_WOMPI_EVENT,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
      OR: ids.map((id) => ({ payload: { path: ["webhookEventId"], equals: id } as any }))
    },
    select: { payload: true }
  });
  const pendingIds = new Set(
    pendingJobs
      .map((j: any) => String((j?.payload as any)?.webhookEventId || "").trim())
      .filter(Boolean)
  );
  const toEnqueue = ids.filter((id) => !pendingIds.has(id));
  if (!toEnqueue.length) return;

  await prisma.retryJob.createMany({
    data: toEnqueue.map((webhookEventId) => ({
      type: RetryJobType.PROCESS_WOMPI_EVENT,
      runAt: new Date(),
      maxAttempts: 12,
      payload: { webhookEventId }
    })),
    skipDuplicates: false
  });

  await systemLog(LogLevel.INFO, "payments.reconcile.webhooks", "Wompi webhook recovery queued", {
    scanned: ids.length,
    queued: toEnqueue.length,
    lookbackMinutes
  }).catch((err) => {
    logger.warn({ err, queued: toEnqueue.length }, '[Jobs/WebhookRecovery] Fallo creando systemLog');
  });
}

async function ensureDueCutoffRetries() {
  const cfg = await getAutoDebitConfig();
  if (!cfg.enabled || !cfg.chargeAtCutoffEnabled) return;

  const now = Date.now();
  const everySecondsRaw = Number(process.env.DUE_CUTOFF_SCAN_SECONDS || 30);
  const everyMs = (Number.isFinite(everySecondsRaw) ? Math.max(15, Math.trunc(everySecondsRaw)) : 30) * 1000;
  if (now - lastEnsureDueCutoffRetriesAtMs < everyMs) return;
  lastEnsureDueCutoffRetriesAtMs = now;

  const toleranceSecondsRaw = Number(process.env.DUE_CUTOFF_TOLERANCE_SECONDS || 30);
  const toleranceSeconds = Number.isFinite(toleranceSecondsRaw) ? Math.max(5, Math.trunc(toleranceSecondsRaw)) : 30;
  const dueUntil = new Date(now + toleranceSeconds * 1000);
  const retrySpacingMinutes = cfg.retryEnabled ? Math.max(1, Math.trunc(cfg.retryEveryMinutes || 60)) : 60;
  const retrySpacingSince = new Date(now - retrySpacingMinutes * 60 * 1000);

  const candidates = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] as any },
      currentPeriodEndAt: { lte: dueUntil }
    },
    orderBy: { currentPeriodEndAt: "asc" },
    take: 250,
    select: {
      id: true,
      currentPeriodEndAt: true,
      plan: { select: { metadata: true } }
    }
  });
  if (!candidates.length) return;

  let queued = 0;
  for (const sub of candidates) {
    const mode = resolveSubscriptionCollectionMode(sub);
    if (mode !== "AUTO_DEBIT" && mode !== "AUTO_LINK") continue;

    const exists = await prisma.retryJob.findFirst({
      where: {
        type: RetryJobType.PAYMENT_RETRY,
        status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
        payload: { path: ["subscriptionId"], equals: sub.id } as any,
        runAt: { gte: new Date(now - 2 * 60 * 1000) }
      },
      select: { id: true }
    });
    if (exists) continue;

    // Evita tormenta de jobs para suscripciones vencidas históricas.
    // Si ya hubo un intento reciente de cobro/reintento para la misma suscripción,
    // respetamos la ventana configurada de reintento.
    const recentRetry = await prisma.retryJob.findFirst({
      where: {
        type: RetryJobType.PAYMENT_RETRY,
        payload: { path: ["subscriptionId"], equals: sub.id } as any,
        updatedAt: { gte: retrySpacingSince }
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });
    if (recentRetry) continue;

    await ensurePaymentRetryJob({
      subscriptionId: sub.id,
      runAt: new Date(),
      maxAttempts: 5
    }).catch((err) => {
      logger.warn({ err, subscriptionId: sub.id }, '[Jobs/PaymentRetry] Fallo encolando retry');
    });
    queued += 1;
  }

  if (queued > 0) {
    await systemLog(LogLevel.INFO, "jobs.payment_retry", "Cobros por fecha de corte encolados", {
      scanned: candidates.length,
      queued,
      dueUntil: dueUntil.toISOString()
    }).catch((err) => {
      logger.warn({ err, queued }, '[Jobs/PaymentRetry] Fallo creando systemLog');
    });
  }
}

async function ensurePaymentRetryQueueHealth() {
  const now = Date.now();
  if (now - lastEnsurePaymentRetryQueueHealthAtMs < 60_000) return;
  lastEnsurePaymentRetryQueueHealthAtMs = now;

  // Keep a single active PAYMENT_RETRY per subscription.
  await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY payload->>'subscriptionId'
          ORDER BY "runAt" ASC, "createdAt" ASC, id ASC
        ) AS rn
      FROM "RetryJob"
      WHERE type = 'PAYMENT_RETRY'
        AND status IN ('PENDING','RUNNING')
        AND payload ? 'subscriptionId'
    )
    UPDATE "RetryJob" r
    SET status = 'FAILED',
        "lastError" = 'dedupe_payment_retry_same_subscription',
        "updatedAt" = NOW(),
        "lockedAt" = NULL,
        "lockedBy" = NULL
    FROM ranked k
    WHERE r.id = k.id
      AND k.rn > 1
  `);

  // Ensure each AUTO_* subscription has one active job.
  const subs = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "PAST_DUE"] as any } },
    select: {
      id: true,
      status: true,
      currentPeriodEndAt: true,
      metadata: true,
      plan: { select: { metadata: true } }
    },
    take: 1000
  });
  if (!subs.length) return;

  const nowDate = new Date();
  const futureToleranceMs = 5_000;
  for (const sub of subs) {
    const mode = resolveSubscriptionCollectionMode(sub);
    if (mode !== "AUTO_DEBIT" && mode !== "AUTO_LINK") continue;

    const cutoffMs = sub.currentPeriodEndAt?.getTime?.() ?? 0;
    const runAt = cutoffMs > now + futureToleranceMs ? new Date(cutoffMs) : nowDate;
    await ensurePaymentRetryJob({ subscriptionId: sub.id, runAt, maxAttempts: 1 }).catch((err) => {
      logger.warn({ err, subscriptionId: sub.id }, '[Jobs/PaymentRetry] Fallo encolando retry de suscripción');
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
    where: { status: RetryJobStatus.FAILED, type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY },
    data: { status: RetryJobStatus.PENDING, runAt: new Date(), lockedAt: null, lockedBy: null }
  });
  if (result.count) {
    logger.info({ retried: result.count }, "Shopify forward retries enqueued");
  }
}

async function runOnce() {
  const jobs = await claimJobs(10);
  for (const job of jobs) {
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
        continue;
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
        continue;
      }
      const attempts = job.attempts + 1;
      let status: RetryJobStatus = attempts >= job.maxAttempts ? RetryJobStatus.FAILED : RetryJobStatus.PENDING;
      let runAt: Date | undefined = status === RetryJobStatus.PENDING ? nextRunAt(attempts) : undefined;
      if (job.type === RetryJobType.PAYMENT_RETRY) {
        const cfg = await getAutoDebitConfig();
        const canRetry = cfg.enabled && cfg.retryEnabled && attempts <= cfg.maxRetries;
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
    }
  }
}

async function main() {
  logger.info({ workerId }, "Jobs runner started");
  // eslint-disable-next-line no-constant-condition
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
      // Common during first boot if migrations haven't been applied yet.
      logger.warn({ err: msg }, "Jobs runner transient failure; retrying soon");
      const short = String(msg || "").replace(/\s+/g, " ").trim().slice(0, 240);
      const lower = String(msg || "").toLowerCase();
      const isDbSlots = lower.includes("remaining connection slots are reserved");
      const hint = isDbSlots
        ? "Base de datos sin cupos de conexión. Reduce conexiones/pool del API y worker, o aumenta límites en la BD."
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
