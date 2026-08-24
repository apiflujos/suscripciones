"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collectionAttempts_1 = require("../services/collectionAttempts");
const prisma_1 = require("../db/prisma");
const logger_1 = require("../lib/logger");
const env_1 = require("../config/env");
const client_1 = require("@prisma/client");
const processWompiEvent_1 = require("./handlers/processWompiEvent");
const sendChatwootMessage_1 = require("./handlers/sendChatwootMessage");
const paymentRetry_1 = require("./handlers/paymentRetry");
const subscriptionReminder_1 = require("./handlers/subscriptionReminder");
const systemLog_1 = require("../services/systemLog");
const runtimeConfig_1 = require("../services/runtimeConfig");
const subscriptionAutomationConfig_1 = require("../services/subscriptionAutomationConfig");
const billingMonthlyReport_1 = require("./handlers/billingMonthlyReport");
const sendCampaign_1 = require("./handlers/sendCampaign");
const syncSmartLists_1 = require("./handlers/syncSmartLists");
const aiAssist_1 = require("./handlers/aiAssist");
const gamificationRecalc_1 = require("./handlers/gamificationRecalc");
const dataTrainer_1 = require("./handlers/dataTrainer");
const chatwootDelivery_1 = require("../services/chatwootDelivery");
const wompiReconcile_1 = require("../services/wompiReconcile");
const subscriptionMode_1 = require("../services/subscriptionMode");
const retryJobScheduler_1 = require("../services/retryJobScheduler");
const notificationsScheduler_1 = require("../services/notificationsScheduler");
const timeZoneScheduling_1 = require("../lib/timeZoneScheduling");
const subscriptionBilling_1 = require("../services/subscriptionBilling");
const actorStore_1 = require("../services/actorStore");
const realtimePublisher_1 = require("../services/realtimePublisher");
const billingCycles_1 = require("../services/billingCycles");
const job_payload_schemas_1 = require("../lib/job-payload-schemas");
(0, env_1.loadEnv)(process.env);
const workerId = `jobs:${process.pid}`;
const workerHeartbeatKey = String(process.env.JOBS_HEARTBEAT_KEY || "wompi-subs-jobs").trim() || "wompi-subs-jobs";
let lastShopifyForwardRetryAt = 0;
let lastHeartbeatAtMs = 0;
const BOGOTA_TZ = "America/Bogota";
const MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE = Number(process.env.MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE ?? "2000");
function monthKeyUtc(y, m0) {
    return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}
function computeNextMonthlyReportJob(nowMs) {
    // Use real timezone parts instead of a hardcoded UTC-5 offset
    const { year, month, day, hour, minute } = (0, timeZoneScheduling_1.getZonedParts)(new Date(nowMs), BOGOTA_TZ);
    // month is 1-indexed (1=Jan, 12=Dec)
    const isDay1Before005 = day === 1 && hour === 0 && minute < 5;
    const runYear = isDay1Before005 ? year : month === 12 ? year + 1 : year;
    const runMonth1 = isDay1Before005 ? month : month === 12 ? 1 : month + 1;
    // Schedule at 00:05 Bogotá on the 1st of the target month
    const firstOfMonth = new Date(Date.UTC(runYear, runMonth1 - 1, 1, 12, 0, 0));
    const runAt = (0, timeZoneScheduling_1.applyClockTimeInZone)(firstOfMonth, "00:05", BOGOTA_TZ);
    const prevMonth1 = runMonth1 === 1 ? 12 : runMonth1 - 1;
    const prevYear = runMonth1 === 1 ? runYear - 1 : runYear;
    const periodKey = monthKeyUtc(prevYear, prevMonth1 - 1);
    return { runAt, periodKey };
}
async function claimJobs(limit) {
    return prisma_1.prisma.$queryRaw `
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
function nextRunAt(attempts) {
    const baseMs = 5_000;
    const delayMs = Math.min(5 * 60_000, baseMs * Math.pow(2, Math.max(0, attempts)));
    return new Date(Date.now() + delayMs);
}
function nextRunAtMinutes(minutes) {
    const normalized = Number.isFinite(minutes) ? Math.max(1, Math.trunc(minutes)) : 60;
    return new Date(Date.now() + normalized * 60_000);
}
let lastEnsureAtMs = 0;
let lastEnsureSmartListsAtMs = 0;
let lastLogCleanupAtMs = 0;
let lastRetryJobCleanupAtMs = 0;
let lastGamificationRecalcAtMs = 0;
let lastDataTrainerAtMs = 0;
let lastAutoReconcileAtMs = 0;
let lastWebhookRecoveryAtMs = 0;
let lastEnsureDueCutoffRetriesAtMs = 0;
let lastEnsurePaymentRetryQueueHealthAtMs = 0;
let lastChatwootDeliveryReconcileAtMs = 0;
function getRunnerErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
async function ensureMonthlyBillingReportJob() {
    const now = Date.now();
    if (now - lastEnsureAtMs < 60_000)
        return;
    lastEnsureAtMs = now;
    const next = computeNextMonthlyReportJob(now);
    const existing = await prisma_1.prisma.retryJob.findFirst({
        where: {
            type: client_1.RetryJobType.BILLING_MONTHLY_REPORT,
            payload: { path: ["periodKey"], equals: next.periodKey }
        }
    });
    if (existing)
        return;
    await prisma_1.prisma.retryJob
        .create({
        data: {
            type: client_1.RetryJobType.BILLING_MONTHLY_REPORT,
            runAt: next.runAt,
            maxAttempts: 10,
            payload: { periodKey: next.periodKey }
        }
    })
        .catch((err) => {
        logger_1.logger.warn({ err, periodKey: next.periodKey }, '[Jobs/Billing] Fallo creando job de reporte mensual');
    });
}
async function ensureSmartListsSyncJob() {
    const now = Date.now();
    const minutesRaw = Number(process.env.SMART_LISTS_SYNC_MINUTES || 15);
    const minutes = Number.isFinite(minutesRaw) ? Math.max(5, Math.trunc(minutesRaw)) : 15;
    if (now - lastEnsureSmartListsAtMs < minutes * 60_000)
        return;
    lastEnsureSmartListsAtMs = now;
    const recent = new Date(now - minutes * 60_000);
    const existing = await prisma_1.prisma.retryJob.findFirst({
        where: {
            type: client_1.RetryJobType.SYNC_SMART_LISTS,
            status: { in: [client_1.RetryJobStatus.PENDING, client_1.RetryJobStatus.RUNNING] },
            runAt: { gte: recent }
        }
    });
    if (existing)
        return;
    await prisma_1.prisma.retryJob
        .create({
        data: {
            type: client_1.RetryJobType.SYNC_SMART_LISTS,
            runAt: new Date(),
            maxAttempts: 5,
            payload: { reason: "auto" }
        }
    })
        .catch((err) => {
        logger_1.logger.warn({ err }, '[Jobs/SmartLists] Fallo creando job de sincronización');
    });
}
async function ensureGamificationRecalcJob() {
    const now = Date.now();
    if (now - lastGamificationRecalcAtMs < 60 * 60 * 1000)
        return;
    lastGamificationRecalcAtMs = now;
    const existing = await prisma_1.prisma.retryJob.findFirst({
        where: {
            type: client_1.RetryJobType.GAMIFICATION_RECALC,
            status: { in: [client_1.RetryJobStatus.PENDING, client_1.RetryJobStatus.RUNNING] }
        }
    });
    if (existing)
        return;
    await prisma_1.prisma.retryJob.create({
        data: {
            type: client_1.RetryJobType.GAMIFICATION_RECALC,
            runAt: new Date(),
            maxAttempts: 3,
            payload: { reason: "auto" }
        }
    }).catch((err) => {
        logger_1.logger.warn({ err }, '[Jobs/Gamification] Fallo creando job de recálculo');
    });
}
async function ensureDataTrainerJob() {
    const now = Date.now();
    if (now - lastDataTrainerAtMs < 4 * 60 * 60 * 1000)
        return;
    lastDataTrainerAtMs = now;
    const existing = await prisma_1.prisma.retryJob.findFirst({
        where: {
            type: client_1.RetryJobType.DATA_TRAINER,
            status: { in: [client_1.RetryJobStatus.PENDING, client_1.RetryJobStatus.RUNNING] }
        }
    });
    if (existing)
        return;
    await prisma_1.prisma.retryJob.create({
        data: {
            type: client_1.RetryJobType.DATA_TRAINER,
            runAt: new Date(),
            maxAttempts: 3,
            payload: { reason: "auto" }
        }
    }).catch((err) => {
        logger_1.logger.warn({ err }, '[Jobs/DataTrainer] Fallo creando job de entrenamiento');
    });
}
async function ensureLogCleanup() {
    const now = Date.now();
    if (now - lastLogCleanupAtMs < 24 * 60 * 60 * 1000)
        return;
    lastLogCleanupAtMs = now;
    const days = Number(process.env.AUDIT_LOG_RETENTION_DAYS || process.env.LOG_RETENTION_DAYS || 60);
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    await prisma_1.prisma.systemLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
async function ensureRetryJobCleanup() {
    const now = Date.now();
    if (now - lastRetryJobCleanupAtMs < 24 * 60 * 60 * 1000)
        return;
    lastRetryJobCleanupAtMs = now;
    const days = Number(process.env.RETRY_JOB_RETENTION_DAYS || 30);
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const [deletedSucceeded, deletedFailed] = await Promise.all([
        prisma_1.prisma.retryJob.deleteMany({
            where: {
                status: client_1.RetryJobStatus.SUCCEEDED,
                updatedAt: { lt: cutoff }
            }
        }),
        prisma_1.prisma.retryJob.deleteMany({
            where: {
                status: client_1.RetryJobStatus.FAILED,
                updatedAt: { lt: cutoff }
            }
        })
    ]);
    if (deletedSucceeded.count > 0 || deletedFailed.count > 0) {
        logger_1.logger.info({ deletedSucceeded: deletedSucceeded.count, deletedFailed: deletedFailed.count, retentionDays: days }, "retryJob.cleanup");
    }
}
async function ensureJobsHeartbeat() {
    const now = Date.now();
    if (now - lastHeartbeatAtMs < 60_000)
        return;
    lastHeartbeatAtMs = now;
    const heartbeatAt = new Date();
    const meta = { type: "jobs_runner", pid: process.pid };
    await Promise.all([
        prisma_1.prisma.serviceHeartbeat.upsert({
            where: { key: workerId },
            create: { key: workerId, lastSeenAt: heartbeatAt, meta },
            update: { lastSeenAt: heartbeatAt, meta }
        }),
        prisma_1.prisma.serviceHeartbeat.upsert({
            where: { key: workerHeartbeatKey },
            create: { key: workerHeartbeatKey, lastSeenAt: heartbeatAt, meta },
            update: { lastSeenAt: heartbeatAt, meta }
        })
    ]).catch((err) => {
        logger_1.logger.warn({ err, workerId, workerHeartbeatKey }, '[Jobs/Heartbeat] Fallo actualizando heartbeat');
    });
}
async function ensurePendingPaymentsAutoReconcile() {
    const now = Date.now();
    if (now - lastAutoReconcileAtMs < 10 * 60 * 1000)
        return;
    lastAutoReconcileAtMs = now;
    const pending = await prisma_1.prisma.payment.findMany({
        where: { status: "PENDING", wompiTransactionId: { not: null }, createdAt: { lt: new Date(now - 15 * 60 * 1000) } },
        take: 50,
        orderBy: { createdAt: "asc" }
    });
    if (!pending.length)
        return;
    let reconciled = 0;
    let tried = 0;
    for (const p of pending) {
        tried++;
        try {
            const res = await (0, wompiReconcile_1.reconcileWompiTransaction)({ wompiTransactionId: String(p.wompiTransactionId || "") });
            if (res.status !== "PENDING")
                reconciled++;
        }
        catch (err) {
            logger_1.logger.warn({ err, paymentId: p.id }, '[Jobs/Reconcile] Fallo en reconciliación automática');
        }
    }
    if (tried > 0) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "payments.reconcile.auto", "Auto reconcile run", { tried, reconciled }).catch((err) => {
            logger_1.logger.warn({ err, tried, reconciled }, '[Jobs/Reconcile] Fallo creando systemLog');
        });
    }
}
async function ensureWompiWebhookRecoveryJobs() {
    const now = Date.now();
    if (now - lastWebhookRecoveryAtMs < 60 * 60 * 1000)
        return;
    lastWebhookRecoveryAtMs = now;
    const stale = await prisma_1.prisma.webhookEvent.findMany({
        where: {
            provider: client_1.WebhookProvider.WOMPI,
            processStatus: client_1.WebhookProcessStatus.RECEIVED,
            receivedAt: { lt: new Date(now - 30 * 60 * 1000) }
        },
        take: 100,
        select: { id: true }
    });
    if (!stale.length)
        return;
    const toEnqueue = [];
    for (const ev of stale) {
        const existing = await prisma_1.prisma.retryJob.findFirst({
            where: { type: client_1.RetryJobType.PROCESS_WOMPI_EVENT, payload: { path: ["webhookEventId"], equals: ev.id } }
        });
        if (!existing)
            toEnqueue.push(ev.id);
    }
    if (toEnqueue.length) {
        await prisma_1.prisma.retryJob.createMany({
            data: toEnqueue.map((id) => ({
                type: client_1.RetryJobType.PROCESS_WOMPI_EVENT,
                payload: { webhookEventId: id },
                runAt: new Date()
            }))
        });
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "payments.reconcile.webhooks", "Wompi webhook recovery queued", { count: toEnqueue.length }).catch((err) => {
            logger_1.logger.warn({ err, queued: toEnqueue.length }, '[Jobs/WebhookRecovery] Fallo creando systemLog');
        });
    }
}
/**
 * FIX #1: Evita spam de payment links duplicados.
 * Si ya existe un payment link PENDIENTE reciente para esta suscripción,
 * no se crea otro job de reintento.
 */
async function hasRecentPendingPaymentLink(subscriptionId, windowMs) {
    const recent = await prisma_1.prisma.payment.findFirst({
        where: {
            subscriptionId,
            status: client_1.PaymentStatus.PENDING,
            origin: { in: ["AUTO_LINK", "MANUAL_LINK"] },
            createdAt: { gte: new Date(Date.now() - windowMs) }
        },
        select: { id: true }
    });
    return recent !== null;
}
async function ensureDueCutoffRetries() {
    const now = Date.now();
    // Correr con menos frecuencia (cada 30 min) ya que ahora es solo un respaldo
    if (now - lastEnsureDueCutoffRetriesAtMs < 30 * 60 * 1000)
        return;
    lastEnsureDueCutoffRetriesAtMs = now;
    const autoDebitConfig = await (0, runtimeConfig_1.getAutoDebitConfig)();
    const autoDebitEnabled = autoDebitConfig.enabled;
    const chargeAtCutoffEnabled = autoDebitConfig.chargeAtCutoffEnabled;
    // 1. Limpieza de duplicados (mantiene el más próximo a ejecutar)
    await prisma_1.prisma.$executeRawUnsafe(`
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
    let scheduledNotifications = 0;
    let cursor;
    do {
        const subs = await prisma_1.prisma.subscription.findMany({
            where: { status: { in: ["ACTIVE", "PAST_DUE"] } },
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
        if (!subs.length)
            break;
        processedTotal += subs.length;
        const nowDate = new Date();
        const futureToleranceMs = 5_000;
        for (const sub of subs) {
            // Los avisos de vencimiento solo se agendaban cuando algo tocaba la
            // suscripción: un alta, un cobro, un webhook, un cambio de configuración.
            // Si un ciclo rodaba sin que pasara ninguna de esas cosas, el ciclo entero
            // se quedaba sin avisar. Va antes de los filtros de modo de cobro porque
            // avisar aplica también a las que se cobran con link manual.
            const avisos = await (0, notificationsScheduler_1.scheduleSubscriptionDueNotifications)({
                subscriptionId: sub.id,
                actor: "jobs:safety_sync"
            }).catch((err) => {
                logger_1.logger.warn({ err, subscriptionId: sub.id }, '[Jobs/SafetySync] Fallo agendando avisos de vencimiento');
                return null;
            });
            scheduledNotifications += avisos?.scheduled || 0;
            const mode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(sub);
            if (mode !== "AUTO_DEBIT" && mode !== "AUTO_LINK")
                continue;
            // Si es AUTO_DEBIT y el cobro en corte está apagado, omitir creación de Job.
            if (mode === "AUTO_DEBIT" && (!autoDebitEnabled || !chargeAtCutoffEnabled))
                continue;
            // FIX #1: Si ya hay un payment link pendiente reciente, saltar para evitar spam.
            // Ventana de 2 horas: si se creó un link en las últimas 2h, no crear otro.
            const hasRecent = await hasRecentPendingPaymentLink(sub.id, 2 * 60 * 60 * 1000);
            if (hasRecent) {
                skippedRecentLink++;
                continue;
            }
            const billingState = await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: sub.id });
            const collectionCycle = billingState?.collectionCycle || null;
            const collectionCyclePaid = (0, billingCycles_1.isBillingCyclePaid)(collectionCycle);
            if (!collectionCycle || collectionCyclePaid)
                continue;
            // El tope de intentos vale con o sin reintentos activos: antes, con los
            // reintentos encendidos, esta sincronización volvía a agendar cobro para
            // el mismo ciclo en cada pasada, sin techo.
            const intentosCiclo = await (0, collectionAttempts_1.hasExhaustedCycleAttempts)({
                subscriptionId: sub.id,
                cycleNumber: collectionCycle.cycleNumber,
                config: autoDebitConfig
            }).catch(() => ({ exhausted: false, attempts: 0, allowed: 1 }));
            if (intentosCiclo.exhausted) {
                skippedExhausted++;
                continue;
            }
            if (!autoDebitConfig.retryEnabled) {
                const existingCyclePayment = await prisma_1.prisma.payment.findFirst({
                    where: {
                        subscriptionId: sub.id,
                        status: {
                            in: [
                                client_1.PaymentStatus.PENDING,
                                client_1.PaymentStatus.DECLINED,
                                client_1.PaymentStatus.ERROR,
                                client_1.PaymentStatus.VOIDED,
                                client_1.PaymentStatus.APPROVED
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
                ? await (0, retryJobScheduler_1.resolvePaymentRetryRunAt)({
                    dueAt,
                    now: nowDate,
                    config: autoDebitConfig
                })
                : nowDate;
            // ensurePaymentRetryJob internamente revisa si ya existe uno pendiente.
            const job = await (0, retryJobScheduler_1.ensurePaymentRetryJob)({ subscriptionId: sub.id, runAt, maxAttempts: 1 }).catch((err) => {
                logger_1.logger.warn({ err, subscriptionId: sub.id }, '[Jobs/SafetySync] Fallo en sincronización de seguridad');
                return null;
            });
            // Actualizar metadata para que sea visible en el UI
            if (job) {
                createdJobs++;
                const currentMetadata = sub.metadata || {};
                const newMetadata = {
                    ...currentMetadata,
                    autoRetry: {
                        nextRetryAt: runAt.toISOString(),
                        scheduledAt: new Date().toISOString(),
                        source: "ensureDueCutoffRetries",
                        runAt: runAt.toISOString()
                    }
                };
                await prisma_1.prisma.subscription.update({
                    where: { id: sub.id },
                    data: { metadata: newMetadata }
                }).catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: sub.id }, '[Jobs/SafetySync] Fallo al actualizar metadata de reintento');
                });
            }
        }
        if (processedTotal >= MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE) {
            logger_1.logger.info({ processedTotal, limit: MAX_SUBSCRIPTIONS_PER_CUTOFF_CYCLE }, "[Jobs/SafetySync] Límite de suscripciones por ciclo alcanzado, continuará en el siguiente ciclo");
            break;
        }
        // Avanzar cursor
        cursor = subs[subs.length - 1].id;
        // Si recibimos menos de PAGE_SIZE, ya no hay más
        if (subs.length < PAGE_SIZE)
            break;
    } while (true);
    // Log de resumen para observabilidad
    if (processedTotal > 0) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "jobs.safety_sync", "Due cutoff retries processed", {
            processedSubscriptions: processedTotal,
            jobsCreated: createdJobs,
            jobsSkippedRecentLink: skippedRecentLink,
            jobsSkippedAttemptsExhausted: skippedExhausted,
            notificationsScheduled: scheduledNotifications
        }).catch((err) => {
            logger_1.logger.warn({ err }, '[Jobs/SafetySync] Fallo creando resumen de seguridad');
        });
    }
}
async function ensurePaymentRetryQueueHealth() {
    const now = Date.now();
    if (now - lastEnsurePaymentRetryQueueHealthAtMs < 60 * 60 * 1000)
        return;
    lastEnsurePaymentRetryQueueHealthAtMs = now;
    const stale = await prisma_1.prisma.retryJob.findMany({
        where: {
            type: client_1.RetryJobType.PAYMENT_RETRY,
            status: client_1.RetryJobStatus.RUNNING,
            lockedAt: { lt: new Date(now - 10 * 60 * 1000) }
        },
        take: 100
    });
    for (const job of stale) {
        const cfg = await (0, runtimeConfig_1.getAutoDebitConfig)().catch(() => null);
        const retryDelayMinutes = Math.max(1, Number(cfg?.retryEveryMinutes || 30));
        await prisma_1.prisma.retryJob.update({
            where: { id: job.id },
            data: {
                status: client_1.RetryJobStatus.PENDING,
                runAt: new Date(now + retryDelayMinutes * 60_000),
                lockedAt: null,
                lockedBy: null,
                attempts: { increment: 1 }
            }
        }).catch((err) => {
            logger_1.logger.warn({ err, jobId: job.id }, "[Jobs/Health] Fallo reencolando retry job estancado");
        });
    }
}
async function ensureChatwootDeliveryReconcile() {
    const now = Date.now();
    if (now - lastChatwootDeliveryReconcileAtMs < 60_000)
        return;
    lastChatwootDeliveryReconcileAtMs = now;
    const result = await (0, chatwootDelivery_1.reconcileRecentChatwootDeliveries)({ windowMinutes: 30, limit: 50 }).catch((err) => {
        logger_1.logger.warn({ err }, "[Jobs/Chatwoot] Fallo reconciliando estados de entrega");
        return null;
    });
    if (result && result.checked > 0) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "chatwoot.delivery", "Chatwoot delivery reconcile run", result).catch((err) => {
            logger_1.logger.warn({ err, result }, "[Jobs/Chatwoot] Fallo creando systemLog de reconciliación");
        });
    }
}
async function ensureShopifyForwardRetries() {
    const now = Date.now();
    const { enabled, minutes } = await (0, runtimeConfig_1.getShopifyForwardRetryConfig)();
    if (!enabled)
        return;
    if (now - lastShopifyForwardRetryAt < minutes * 60 * 1000)
        return;
    const cfg = await (0, runtimeConfig_1.getShopifyForward)();
    if (!cfg.url)
        return;
    lastShopifyForwardRetryAt = now;
    const result = await prisma_1.prisma.retryJob.updateMany({
        where: {
            status: client_1.RetryJobStatus.FAILED,
            type: client_1.RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
            attempts: { lt: 3 }
        },
        data: { status: client_1.RetryJobStatus.PENDING, runAt: new Date(), lockedAt: null, lockedBy: null }
    });
    if (result.count) {
        logger_1.logger.info({ retried: result.count }, "Shopify forward retries enqueued");
    }
}
function getActorForJobType(type) {
    if (type === client_1.RetryJobType.PROCESS_WOMPI_EVENT)
        return systemLog_1.SystemActor.JOB_PROCESS_WOMPI;
    if (type === client_1.RetryJobType.PAYMENT_RETRY)
        return systemLog_1.SystemActor.JOB_PAYMENT_RETRY;
    if (type === client_1.RetryJobType.SUBSCRIPTION_REMINDER)
        return systemLog_1.SystemActor.JOB_SUBSCRIPTION_REMINDER;
    if (type === client_1.RetryJobType.SEND_CHATWOOT_MESSAGE)
        return systemLog_1.SystemActor.JOB_SEND_CHATWOOT;
    return `job:${type}`;
}
async function runOnce() {
    const jobs = await claimJobs(10);
    for (const job of jobs) {
        const actor = getActorForJobType(job.type);
        await (0, actorStore_1.runWithActor)(actor, async () => {
            try {
                let paymentRetryOutcome = null;
                if (job.type === client_1.RetryJobType.PROCESS_WOMPI_EVENT) {
                    const parsed = job_payload_schemas_1.processWompiEventSchema.safeParse(job.payload);
                    if (!parsed.success) {
                        logger_1.logger.warn({ jobId: job.id, errors: parsed.error.flatten() }, "job payload inválido");
                        await prisma_1.prisma.retryJob.update({
                            where: { id: job.id },
                            data: {
                                status: client_1.RetryJobStatus.FAILED,
                                lastError: "invalid_payload",
                                lockedAt: null,
                                lockedBy: null
                            }
                        });
                        return;
                    }
                    const p = parsed.data;
                    await (0, processWompiEvent_1.processWompiEvent)(p.webhookEventId);
                }
                else if (job.type === client_1.RetryJobType.FORWARD_WOMPI_TO_SHOPIFY) {
                    const parsed = job_payload_schemas_1.forwardToShopifySchema.safeParse(job.payload);
                    if (!parsed.success) {
                        logger_1.logger.warn({ jobId: job.id, errors: parsed.error.flatten() }, "job payload inválido");
                        await prisma_1.prisma.retryJob.update({
                            where: { id: job.id },
                            data: {
                                status: client_1.RetryJobStatus.FAILED,
                                lastError: "invalid_payload",
                                lockedAt: null,
                                lockedBy: null
                            }
                        });
                        return;
                    }
                    const p = parsed.data;
                    await (0, processWompiEvent_1.forwardWompiToShopify)(p.webhookEventId);
                }
                else if (job.type === client_1.RetryJobType.SEND_CHATWOOT_MESSAGE) {
                    const p = job.payload;
                    await (0, sendChatwootMessage_1.sendChatwootMessage)(p.chatwootMessageId);
                }
                else if (job.type === client_1.RetryJobType.PAYMENT_RETRY) {
                    const parsed = job_payload_schemas_1.paymentRetrySchema.safeParse(job.payload);
                    if (!parsed.success) {
                        logger_1.logger.warn({ jobId: job.id, errors: parsed.error.flatten() }, "job payload inválido");
                        await prisma_1.prisma.retryJob.update({
                            where: { id: job.id },
                            data: {
                                status: client_1.RetryJobStatus.FAILED,
                                lastError: "invalid_payload",
                                lockedAt: null,
                                lockedBy: null
                            }
                        });
                        return;
                    }
                    const p = parsed.data;
                    paymentRetryOutcome = await (0, paymentRetry_1.paymentRetry)(p);
                }
                else if (job.type === client_1.RetryJobType.SUBSCRIPTION_REMINDER) {
                    const p = job.payload;
                    await (0, subscriptionReminder_1.subscriptionReminder)(p);
                }
                else if (job.type === client_1.RetryJobType.BILLING_MONTHLY_REPORT) {
                    const p = job.payload;
                    await (0, billingMonthlyReport_1.billingMonthlyReport)(p);
                }
                else if (job.type === client_1.RetryJobType.SEND_CAMPAIGN) {
                    const p = job.payload;
                    if (!p.campaignId)
                        throw new Error("campaign_id_missing");
                    await (0, sendCampaign_1.sendCampaign)(p);
                }
                else if (job.type === client_1.RetryJobType.SYNC_SMART_LISTS) {
                    const _p = job.payload;
                    await (0, syncSmartLists_1.syncSmartLists)();
                }
                else if (job.type === client_1.RetryJobType.AI_ASSIST) {
                    const p = job.payload;
                    await (0, aiAssist_1.aiAssist)(p);
                }
                else if (job.type === client_1.RetryJobType.GAMIFICATION_RECALC) {
                    const p = job.payload;
                    await (0, gamificationRecalc_1.gamificationRecalc)(p);
                }
                else if (job.type === client_1.RetryJobType.DATA_TRAINER) {
                    const p = job.payload;
                    await (0, dataTrainer_1.dataTrainer)(p);
                }
                else {
                    logger_1.logger.warn({ jobId: job.id, type: job.type }, "Unhandled job type");
                }
                if (job.type === client_1.RetryJobType.PAYMENT_RETRY && paymentRetryOutcome?.status === "deferred") {
                    await prisma_1.prisma.retryJob.update({
                        where: { id: job.id },
                        data: {
                            status: client_1.RetryJobStatus.PENDING,
                            runAt: paymentRetryOutcome.nextRunAt || nextRunAtMinutes(30),
                            lastError: paymentRetryOutcome.reason || "retry_deferred",
                            lockedAt: null,
                            lockedBy: null
                        }
                    });
                    return;
                }
                await prisma_1.prisma.retryJob.update({
                    where: { id: job.id },
                    data: {
                        status: client_1.RetryJobStatus.SUCCEEDED,
                        lastError: job.type === client_1.RetryJobType.PAYMENT_RETRY ? (paymentRetryOutcome?.reason || null) : null,
                        lockedAt: null,
                        lockedBy: null
                    }
                });
                void (0, realtimePublisher_1.publishRealtime)("jobs", {
                    jobId: job.id,
                    type: job.type,
                    status: "SUCCEEDED",
                    attempts: job.attempts + 1,
                    updatedAt: new Date().toISOString()
                });
            }
            catch (err) {
                const errMsg = getRunnerErrorMessage(err);
                if (job.type === client_1.RetryJobType.PAYMENT_RETRY &&
                    (errMsg === "subscription_canceled" ||
                        errMsg === "subscription_suspended" ||
                        errMsg === "subscription_not_found" ||
                        errMsg === "auto_debit_not_allowed_for_collection_mode" ||
                        errMsg === "wompi_reference_already_used_guard" ||
                        errMsg === "payment_already_approved")) {
                    await prisma_1.prisma.retryJob.update({
                        where: { id: job.id },
                        data: {
                            status: client_1.RetryJobStatus.SUCCEEDED,
                            attempts: job.attempts + 1,
                            lastError: errMsg,
                            lockedAt: null,
                            lockedBy: null
                        }
                    });
                    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "jobs.runner", "Cobro automático omitido", {
                        jobId: job.id,
                        type: job.type,
                        reason: errMsg
                    }).catch((logErr) => {
                        logger_1.logger.warn({ logErr, jobId: job.id }, '[Jobs/Runner] Fallo creando systemLog');
                    });
                    return;
                }
                const attempts = job.attempts + 1;
                let status = attempts >= job.maxAttempts ? client_1.RetryJobStatus.FAILED : client_1.RetryJobStatus.PENDING;
                let runAt = status === client_1.RetryJobStatus.PENDING ? nextRunAt(attempts) : undefined;
                if (job.type === client_1.RetryJobType.PAYMENT_RETRY) {
                    const subId = job.payload?.subscriptionId;
                    const cfg = subId
                        ? await (0, subscriptionAutomationConfig_1.resolveEffectiveSubscriptionAutomationConfigById)(subId).catch(() => (0, runtimeConfig_1.getAutoDebitConfig)())
                        : await (0, runtimeConfig_1.getAutoDebitConfig)();
                    const canRetry = Boolean(cfg.retryEnabled) && attempts <= cfg.maxRetries;
                    status = canRetry ? client_1.RetryJobStatus.PENDING : client_1.RetryJobStatus.FAILED;
                    runAt = canRetry ? nextRunAtMinutes(cfg.retryEveryMinutes) : undefined;
                    if (subId && status === client_1.RetryJobStatus.FAILED) {
                        await (0, subscriptionBilling_1.handleSubscriptionPaymentFailure)(subId, errMsg).catch((err) => {
                            logger_1.logger.warn({ err, subscriptionId: subId }, '[Jobs/Runner] Fallo manejando pago fallido');
                        });
                    }
                }
                await prisma_1.prisma.retryJob.update({
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
                logger_1.logger.error({ jobId: job.id, err }, "Job failed");
                await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "jobs.runner", "Job failed", {
                    jobId: job.id,
                    type: job.type,
                    attempts,
                    err: errMsg
                }).catch(() => { });
                void (0, realtimePublisher_1.publishRealtime)("jobs", {
                    jobId: job.id,
                    type: job.type,
                    status: status === client_1.RetryJobStatus.FAILED ? "FAILED" : "PENDING",
                    attempts,
                    err: errMsg,
                    updatedAt: new Date().toISOString()
                });
            }
        });
    }
}
async function main() {
    logger_1.logger.info({ workerId }, "Jobs runner started");
    while (true) {
        try {
            await ensureMonthlyBillingReportJob();
            await ensureSmartListsSyncJob();
            await ensureGamificationRecalcJob();
            await ensureDataTrainerJob();
            await ensureLogCleanup();
            await ensureRetryJobCleanup();
            await ensureShopifyForwardRetries();
            await ensureJobsHeartbeat();
            await ensurePendingPaymentsAutoReconcile();
            await ensureWompiWebhookRecoveryJobs();
            await ensureDueCutoffRetries();
            await ensurePaymentRetryQueueHealth();
            await ensureChatwootDeliveryReconcile();
            await (0, subscriptionBilling_1.ensureExpiredSubscriptions)();
            await runOnce();
            await new Promise((r) => setTimeout(r, 1000));
        }
        catch (err) {
            const msg = err && typeof err === "object" && "meta" in err && err.meta && typeof err.meta === "object" && "message" in err.meta
                ? String(err.meta.message || "")
                : getRunnerErrorMessage(err);
            logger_1.logger.warn({ err: msg }, "Jobs runner transient failure; retrying soon");
            const short = String(msg || "").replace(/\s+/g, " ").trim().slice(0, 240);
            const lower = String(msg || "").toLowerCase();
            const isDbSlots = lower.includes("remaining connection slots are reserved");
            const hint = isDbSlots
                ? "Base de datos sin cupos de conexión. Reduce conexiones/pool del API and worker, o aumenta límites en la BD."
                : "Falla transitoria en jobs. Revisa logs y estado de base de datos/credenciales.";
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "jobs.runner", short ? `Transient failure (will retry): ${short}` : "Transient failure (will retry)", {
                err: msg,
                reasonCode: isDbSlots ? "db_connection_slots_exhausted" : "transient_jobs_failure",
                actionHint: hint
            }).catch((logErr) => {
                logger_1.logger.warn({ logErr, err: msg }, '[Jobs/Runner] Fallo creando systemLog de error');
            });
            await new Promise((r) => setTimeout(r, 5000));
        }
    }
}
main().catch((err) => {
    logger_1.logger.fatal({ err }, "Jobs runner crashed");
    process.exit(1);
});
