"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleSubscriptionDueNotifications = scheduleSubscriptionDueNotifications;
exports.schedulePaymentStatusNotifications = schedulePaymentStatusNotifications;
exports.schedulePaymentLinkNotifications = schedulePaymentLinkNotifications;
exports.scheduleCatalogLinkNotifications = scheduleCatalogLinkNotifications;
exports.scheduleTokenizationLinkNotifications = scheduleTokenizationLinkNotifications;
const client_1 = require("@prisma/client");
const prisma_1 = require("../db/prisma");
const logger_1 = require("../lib/logger");
const timeZoneScheduling_1 = require("../lib/timeZoneScheduling");
const notificationsConfig_1 = require("./notificationsConfig");
const runtimeConfig_1 = require("./runtimeConfig");
const systemLog_1 = require("./systemLog");
const subscriptionReminder_1 = require("../jobs/handlers/subscriptionReminder");
const classifyReference_1 = require("../webhooks/wompi/classifyReference");
const billingCycles_1 = require("./billingCycles");
const subscriptionMode_1 = require("./subscriptionMode");
const publicBase_1 = require("./publicBase");
function toMsSeconds(seconds) {
    return seconds * 1000;
}
function resolveOffsetsSeconds(rule) {
    if (Array.isArray(rule.offsetsSeconds) && rule.offsetsSeconds.length)
        return rule.offsetsSeconds;
    if (Array.isArray(rule.offsetsMinutes) && rule.offsetsMinutes.length) {
        return rule.offsetsMinutes.map((m) => m * 60);
    }
    return [0];
}
function clampRunAt(runAt, now) {
    return runAt.getTime() < now.getTime() ? now : runAt;
}
// Cuánto atraso se tolera antes de descartar un aviso en vez de dispararlo.
// Seis horas alcanzan para un worker caído un rato; más que eso ya es un aviso
// viejo que no le sirve a nadie.
const STALE_RUN_AT_TOLERANCE_MS = 6 * 60 * 60 * 1000;
async function resolveScheduledRunAt(args) {
    const atTime = String(args.atTime || "").trim();
    if (!atTime)
        return args.base;
    const timeZone = (await (0, runtimeConfig_1.getAutoDebitConfig)().then((cfg) => String(cfg?.timeZone || "").trim()).catch(() => "")) ||
        (await (0, runtimeConfig_1.getAppTimeZone)().catch(() => "America/Bogota"));
    return (0, timeZoneScheduling_1.applyClockTimeInZone)(args.base, atTime, timeZone);
}
async function enqueueNotificationJob(runAt, payload) {
    await prisma_1.prisma.retryJob.create({
        data: {
            type: client_1.RetryJobType.SUBSCRIPTION_REMINDER,
            runAt,
            payload
        }
    });
}
async function scheduleSubscriptionDueNotifications(args) {
    const subscriptionId = String(args.subscriptionId || "").trim();
    if (!subscriptionId)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const sub = await prisma_1.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: {
            id: true,
            customerId: true
        }
    });
    if (!sub)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const billingState = await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: sub.id });
    const collectionCycle = billingState?.collectionCycle || null;
    if (!collectionCycle)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const cfg = await (0, notificationsConfig_1.getNotificationsConfig)();
    const resolvedMode = billingState?.subscription ? (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(billingState.subscription) : null;
    const paymentType = resolvedMode === "AUTO_DEBIT" ? "SUBSCRIPTION" : "LINK";
    const rules = (0, notificationsConfig_1.filterNotificationRules)({
        rules: cfg.rules,
        trigger: "SUBSCRIPTION_DUE",
        paymentType
    });
    if (!rules.length) {
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    }
    const now = new Date();
    const anchorAt = new Date(collectionCycle.dueAt || collectionCycle.periodEndAt);
    const anchorIso = anchorAt.toISOString();
    let scheduled = 0;
    let sentNow = 0;
    let skippedStale = 0;
    const errors = [];
    for (const rule of rules) {
        const offsetsSecondsBase = resolveOffsetsSeconds(rule);
        const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
        for (const offsetSeconds of offsetsSeconds) {
            const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
            const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeBogota ?? rule.atTimeUtc });
            const runAt = clampRunAt(runAtRaw, now);
            const payload = {
                trigger: "SUBSCRIPTION_DUE",
                ruleId: rule.id,
                offsetSeconds,
                subscriptionId: sub.id,
                customerId: sub.customerId,
                cycleNumber: collectionCycle.cycleNumber,
                anchorAt: anchorIso
            };
            if (!args.forceNow) {
                // Un recordatorio "antes del vencimiento" anuncia una fecha futura; si la
                // fecha ya pasó, mandarlo sería mentirle al cliente. Para eso está la mora.
                if (offsetSeconds < 0 && now.getTime() > anchorAt.getTime()) {
                    skippedStale++;
                    continue;
                }
                // Y si el momento de envío quedó muy atrás (al agendar ciclos viejos, por
                // ejemplo), tampoco: si no, una sola pasada dispara una avalancha de avisos
                // vencidos de golpe.
                if (now.getTime() - runAtRaw.getTime() > STALE_RUN_AT_TOLERANCE_MS) {
                    skippedStale++;
                    continue;
                }
                const existing = await prisma_1.prisma.retryJob.findFirst({
                    where: {
                        type: client_1.RetryJobType.SUBSCRIPTION_REMINDER,
                        // Sin filtrar por estado, un job cancelado bloqueaba la reprogramación
                        // para siempre: guardar la configuración de cobros cancelaba los avisos
                        // y después este mismo chequeo impedía volver a crearlos.
                        status: { in: [client_1.RetryJobStatus.PENDING, client_1.RetryJobStatus.RUNNING, client_1.RetryJobStatus.SUCCEEDED] },
                        payload: { path: ["subscriptionId"], equals: sub.id },
                        AND: [
                            { payload: { path: ["ruleId"], equals: rule.id } },
                            { payload: { path: ["offsetSeconds"], equals: offsetSeconds } },
                            { payload: { path: ["cycleNumber"], equals: collectionCycle.cycleNumber } },
                            { payload: { path: ["anchorAt"], equals: anchorIso } }
                        ]
                    }
                });
                if (existing)
                    continue;
                await enqueueNotificationJob(runAt, payload);
                scheduled++;
            }
            else {
                const result = await (0, subscriptionReminder_1.subscriptionReminder)({ ...payload, immediateSend: true }).catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: sub.id }, '[Notifications/Schedule] Fallo en envío inline de subscription due');
                    return { ok: false, error: err?.message ? String(err.message) : "unknown_error" };
                });
                if (result && "ok" in result && result.ok)
                    sentNow++;
                else if (result && "ok" in result && !result.ok)
                    errors.push(result.error || "chatwoot_send_failed");
            }
        }
    }
    // Solo dejar rastro cuando algo pasó. Esta función ahora corre en cada pasada
    // del sincronizador para toda la cartera; registrar los "no hice nada" llenaría
    // el log de ruido y taparía lo que sí importa.
    const huboMovimiento = scheduled > 0 || sentNow > 0 || skippedStale > 0 || errors.length > 0;
    if (huboMovimiento) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "notifications.schedule", "Notificaciones programadas", {
            trigger: "SUBSCRIPTION_DUE",
            environment: await (0, notificationsConfig_1.getNotificationsActiveEnv)(),
            subscriptionId: sub.id,
            customerId: sub.customerId,
            currentPeriodEndAt: new Date(collectionCycle.periodEndAt).toISOString(),
            rulesCount: rules.length,
            scheduled,
            sentNow,
            skippedStale
        }, args.actor || systemLog_1.SystemActor.JOB_SUBSCRIPTION_REMINDER).catch((err) => {
            logger_1.logger.warn({ err, subscriptionId: sub.id }, '[Notifications/Schedule] Fallo creando systemLog');
        });
    }
    return { scheduled, sentNow, rulesActive: rules.length > 0, errors };
}
async function schedulePaymentStatusNotifications(args) {
    const paymentId = String(args.paymentId || "").trim();
    if (!paymentId)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const payment = await prisma_1.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, customerId: true, subscriptionId: true, status: true, providerResponse: true, reference: true }
    });
    if (!payment)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const paymentsCfg = await (0, runtimeConfig_1.getPaymentsConfig)().catch(() => null);
    const reconciliationStatus = (() => {
        const resp = payment.providerResponse && typeof payment.providerResponse === "object" ? payment.providerResponse : null;
        return String(resp?.reconciliation?.status || "").toUpperCase();
    })();
    if (reconciliationStatus === "IGNORED_EXTERNAL")
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    if (!payment.subscriptionId && paymentsCfg && paymentsCfg.notifyWhatsappForUnlinkedPayments === false)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const referenceInfo = (0, classifyReference_1.classifyReference)(payment.reference);
    const isInternalRef = referenceInfo.kind === "subscription" || referenceInfo.kind === "order";
    const isShopifyRef = referenceInfo.kind === "shopify";
    if (!payment.subscriptionId && !isInternalRef)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    if (isShopifyRef)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const trigger = payment.status === client_1.PaymentStatus.APPROVED ? "PAYMENT_APPROVED" : payment.status === client_1.PaymentStatus.DECLINED ? "PAYMENT_DECLINED" : null;
    if (!trigger)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const cfg = await (0, notificationsConfig_1.getNotificationsConfig)();
    const billingState = payment.subscriptionId ? await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: payment.subscriptionId }).catch(() => null) : null;
    const resolvedMode = billingState?.subscription ? (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(billingState.subscription) : null;
    const paymentType = resolvedMode === "AUTO_LINK" || resolvedMode === "MANUAL_LINK"
        ? "LINK"
        : payment.subscriptionId
            ? "SUBSCRIPTION"
            : "LINK";
    const rules = (0, notificationsConfig_1.filterNotificationRules)({ rules: cfg.rules, trigger, paymentType });
    if (!rules.length) {
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    }
    const now = new Date();
    const anchorAt = now;
    const anchorIso = anchorAt.toISOString();
    let scheduled = 0;
    let sentNow = 0;
    const errors = [];
    for (const rule of rules) {
        const offsetsSecondsBase = resolveOffsetsSeconds(rule);
        const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
        for (const offsetSeconds of offsetsSeconds) {
            const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
            const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeBogota ?? rule.atTimeUtc });
            const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
            const jobPayload = {
                trigger,
                ruleId: rule.id,
                offsetSeconds,
                paymentId: payment.id,
                customerId: payment.customerId,
                subscriptionId: payment.subscriptionId ?? undefined,
                paymentStatus: payment.status,
                anchorAt: anchorIso,
                paymentType
            };
            if (!args.forceNow && runAt.getTime() > now.getTime()) {
                await enqueueNotificationJob(runAt, jobPayload);
                scheduled++;
            }
            else {
                const result = await (0, subscriptionReminder_1.subscriptionReminder)({ ...jobPayload, immediateSend: true }).catch((err) => {
                    logger_1.logger.warn({ err, paymentId, trigger }, '[Notifications/Schedule] Fallo en envío inline de payment status');
                    return { ok: false, error: err?.message ? String(err.message) : "unknown_error" };
                });
                if (result && "ok" in result && result.ok)
                    sentNow++;
                else if (result && "ok" in result && !result.ok)
                    errors.push(result.error || "chatwoot_send_failed");
            }
        }
    }
    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "notifications.schedule", "Notificaciones programadas", {
        trigger,
        environment: await (0, notificationsConfig_1.getNotificationsActiveEnv)(),
        paymentId: payment.id,
        scheduled,
        sentNow
    }, args.actor || systemLog_1.SystemActor.SYSTEM).catch((err) => {
        logger_1.logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo creando systemLog');
    });
    return { scheduled, sentNow, rulesActive: rules.length > 0, errors };
}
async function schedulePaymentLinkNotifications(args) {
    const paymentId = String(args.paymentId || "").trim();
    if (!paymentId)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const paymentLinkUrl = (0, publicBase_1.normalizePublicUrl)(args.paymentLinkUrl);
    const payment = await prisma_1.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, customerId: true, subscriptionId: true }
    });
    if (!payment)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const cfg = await (0, notificationsConfig_1.getNotificationsConfig)();
    const billingState = payment.subscriptionId ? await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: payment.subscriptionId }).catch(() => null) : null;
    const resolvedMode = billingState?.subscription ? (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(billingState.subscription) : null;
    const paymentType = resolvedMode === "AUTO_LINK" || resolvedMode === "MANUAL_LINK"
        ? "LINK"
        : payment.subscriptionId
            ? "SUBSCRIPTION"
            : "LINK";
    const rules = (0, notificationsConfig_1.filterNotificationRules)({ rules: cfg.rules, trigger: "PAYMENT_LINK_CREATED", paymentType });
    if (!rules.length) {
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    }
    const now = new Date();
    const anchorAt = now;
    const anchorIso = anchorAt.toISOString();
    let scheduled = 0;
    let sentNow = 0;
    const errors = [];
    for (const rule of rules) {
        const offsetsSecondsBase = resolveOffsetsSeconds(rule);
        const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
        for (const offsetSeconds of offsetsSeconds) {
            const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
            const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeBogota ?? rule.atTimeUtc });
            const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
            const jobPayload = {
                trigger: "PAYMENT_LINK_CREATED",
                ruleId: rule.id,
                offsetSeconds,
                paymentId: payment.id,
                customerId: payment.customerId,
                ...(payment.subscriptionId ? { subscriptionId: payment.subscriptionId } : {}),
                anchorAt: anchorIso,
                paymentType,
                ...(paymentLinkUrl ? { paymentLinkUrl } : {}),
                ...(args.forceNow ? { immediateSend: true } : {})
            };
            if (!args.forceNow && runAt.getTime() > now.getTime()) {
                await enqueueNotificationJob(runAt, jobPayload);
                scheduled++;
            }
            else {
                const result = await (0, subscriptionReminder_1.subscriptionReminder)(jobPayload).catch((err) => {
                    logger_1.logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo en envío inline de payment link');
                    return { ok: false, error: err?.message ? String(err.message) : "unknown_error" };
                });
                if (result && "ok" in result && !result.ok) {
                    errors.push(result.error || "chatwoot_send_failed");
                }
                else {
                    sentNow++;
                }
            }
        }
    }
    const logLevel = args.forceNow
        ? sentNow > 0
            ? client_1.LogLevel.INFO
            : client_1.LogLevel.WARN
        : scheduled > 0
            ? client_1.LogLevel.INFO
            : client_1.LogLevel.WARN;
    await (0, systemLog_1.systemLog)(logLevel, "notifications.schedule", args.forceNow
        ? sentNow > 0
            ? "Notificaciones enviadas"
            : "Notificaciones sin entrega"
        : scheduled > 0
            ? "Notificaciones programadas"
            : "Notificaciones sin programación", {
        trigger: "PAYMENT_LINK_CREATED",
        environment: await (0, notificationsConfig_1.getNotificationsActiveEnv)(),
        paymentId: payment.id,
        customerId: payment.customerId,
        paymentType,
        scheduled,
        sentNow,
        errorsCount: errors.length
    }, args.actor || systemLog_1.SystemActor.SYSTEM).catch((err) => {
        logger_1.logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo creando systemLog');
    });
    return { scheduled, sentNow, rulesActive: true, errors };
}
async function scheduleCatalogLinkNotifications(args) {
    const customerId = String(args.customerId || "").trim();
    const catalogUrl = (0, publicBase_1.normalizePublicUrl)(args.catalogUrl);
    if (!customerId || !catalogUrl)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const cfg = await (0, notificationsConfig_1.getNotificationsConfig)();
    const rules = (0, notificationsConfig_1.filterNotificationRules)({ rules: cfg.rules, trigger: "CATALOG_LINK_CREATED", paymentType: args.paymentType || undefined });
    if (!rules.length) {
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    }
    const now = new Date();
    const anchorAt = now;
    const anchorIso = anchorAt.toISOString();
    let scheduled = 0;
    let sentNow = 0;
    const errors = [];
    for (const rule of rules) {
        const offsetsSecondsBase = resolveOffsetsSeconds(rule);
        const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
        for (const offsetSeconds of offsetsSeconds) {
            const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
            const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeBogota ?? rule.atTimeUtc });
            const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
            const jobPayload = {
                trigger: "CATALOG_LINK_CREATED",
                ruleId: rule.id,
                offsetSeconds,
                customerId,
                catalogUrl,
                anchorAt: anchorIso,
                immediateSend: args.forceNow,
                ...(args.paymentType ? { paymentType: args.paymentType } : {})
            };
            if (!args.forceNow && runAt.getTime() > now.getTime()) {
                await enqueueNotificationJob(runAt, jobPayload);
                scheduled++;
            }
            else {
                const result = await (0, subscriptionReminder_1.subscriptionReminder)(jobPayload).catch((err) => {
                    logger_1.logger.warn({ err, customerId }, '[Notifications/Schedule] Fallo en envío inline de catalog link');
                    return { ok: false, error: err?.message ? String(err.message) : "unknown_error" };
                });
                if (result && "ok" in result && result.ok)
                    sentNow++;
                else if (result && "ok" in result && !result.ok)
                    errors.push(result.error || "chatwoot_send_failed");
            }
        }
    }
    const logLevel = args.forceNow
        ? sentNow > 0
            ? client_1.LogLevel.INFO
            : client_1.LogLevel.WARN
        : scheduled > 0
            ? client_1.LogLevel.INFO
            : client_1.LogLevel.WARN;
    await (0, systemLog_1.systemLog)(logLevel, "notifications.schedule", args.forceNow
        ? sentNow > 0
            ? "Notificaciones enviadas"
            : "Notificaciones sin entrega"
        : scheduled > 0
            ? "Notificaciones programadas"
            : "Notificaciones sin programación", {
        trigger: "CATALOG_LINK_CREATED",
        environment: await (0, notificationsConfig_1.getNotificationsActiveEnv)(),
        customerId,
        scheduled,
        sentNow,
        errorsCount: errors.length
    }, args.actor || systemLog_1.SystemActor.SYSTEM).catch((err) => {
        logger_1.logger.warn({ err, customerId }, '[Notifications/Schedule] Fallo creando systemLog');
    });
    return { scheduled, sentNow, rulesActive: true, errors };
}
async function scheduleTokenizationLinkNotifications(args) {
    const customerId = String(args.customerId || "").trim();
    const tokenUrl = (0, publicBase_1.normalizePublicUrl)(args.tokenUrl);
    if (!customerId || !tokenUrl)
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    const cfg = await (0, notificationsConfig_1.getNotificationsConfig)();
    const rules = (0, notificationsConfig_1.filterNotificationRules)({ rules: cfg.rules, trigger: "TOKENIZATION_LINK_CREATED" });
    if (!rules.length) {
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    }
    const now = new Date();
    const anchorAt = now;
    const anchorIso = anchorAt.toISOString();
    let scheduled = 0;
    let sentNow = 0;
    const errors = [];
    for (const rule of rules) {
        const offsetsSecondsBase = resolveOffsetsSeconds(rule);
        const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
        for (const offsetSeconds of offsetsSeconds) {
            const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
            const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeBogota ?? rule.atTimeUtc });
            const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
            const jobPayload = {
                trigger: "TOKENIZATION_LINK_CREATED",
                ruleId: rule.id,
                offsetSeconds,
                customerId,
                tokenUrl,
                anchorAt: anchorIso,
                tenantId: String(args.tenantId || "").trim() || undefined,
                planId: String(args.planId || "").trim() || undefined,
                productId: String(args.productId || "").trim() || undefined,
                immediateSend: args.forceNow
            };
            if (!args.forceNow && runAt.getTime() > now.getTime()) {
                await enqueueNotificationJob(runAt, jobPayload);
                scheduled++;
            }
            else {
                const result = await (0, subscriptionReminder_1.subscriptionReminder)(jobPayload).catch((err) => {
                    logger_1.logger.warn({ err, customerId, trigger: "TOKENIZATION_LINK_CREATED" }, "[Notifications/Schedule] Fallo en envío inline de tokenización");
                    return { ok: false, error: err?.message ? String(err.message) : "unknown_error" };
                });
                if (result && "ok" in result && result.ok)
                    sentNow++;
                else if (result && "ok" in result && !result.ok)
                    errors.push(result.error || "chatwoot_send_failed");
            }
        }
    }
    const logMessage = args.forceNow
        ? sentNow > 0
            ? "Notificaciones enviadas"
            : "Notificaciones sin entrega"
        : scheduled > 0
            ? "Notificaciones programadas"
            : "Notificaciones sin programación";
    const logLevel = args.forceNow
        ? sentNow > 0
            ? client_1.LogLevel.INFO
            : client_1.LogLevel.WARN
        : scheduled > 0
            ? client_1.LogLevel.INFO
            : client_1.LogLevel.WARN;
    await (0, systemLog_1.systemLog)(logLevel, "notifications.schedule", logMessage, {
        trigger: "TOKENIZATION_LINK_CREATED",
        environment: await (0, notificationsConfig_1.getNotificationsActiveEnv)(),
        customerId,
        scheduled,
        sentNow,
        errorsCount: errors.length
    }, args.actor || systemLog_1.SystemActor.SYSTEM).catch((err) => {
        logger_1.logger.warn({ err, customerId }, "[Notifications/Schedule] Fallo creando systemLog de tokenización");
    });
    return { scheduled, sentNow, rulesActive: true, errors };
}
