"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentRetry = paymentRetry;
const collectionAttempts_1 = require("../../services/collectionAttempts");
const prisma_1 = require("../../db/prisma");
const client_1 = require("@prisma/client");
const subscriptionBilling_1 = require("../../services/subscriptionBilling");
const systemLog_1 = require("../../services/systemLog");
const runtimeConfig_1 = require("../../services/runtimeConfig");
const subscriptionMode_1 = require("../../services/subscriptionMode");
const subscriptionAutomationConfig_1 = require("../../services/subscriptionAutomationConfig");
const realtimePublisher_1 = require("../../services/realtimePublisher");
const billingCycles_1 = require("../../services/billingCycles");
const logger_1 = require("../../lib/logger");
const customerMetadata_1 = require("../../lib/customerMetadata");
function shouldCreateFallbackLinkWhenAutoDebitDisabled() {
    const raw = String(process.env.AUTO_DEBIT_DISABLED_FALLBACK_LINK || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
function asResultMode(raw) {
    const mode = String(raw || "").trim().toUpperCase();
    if (mode === "AUTO_DEBIT")
        return "AUTO_DEBIT";
    if (mode === "AUTO_LINK")
        return "AUTO_LINK";
    return "MANUAL_LINK";
}
function hasUsableCustomerPaymentSource(metadata) {
    return Number.isFinite((0, customerMetadata_1.extractCustomerPaymentSourceId)(metadata));
}
async function createFallbackPaymentLinkOrThrow(args) {
    try {
        await (0, subscriptionBilling_1.createPaymentLinkForSubscription)({ subscriptionId: args.subscriptionId });
    }
    catch (err) {
        const fallbackError = err?.message ? String(err.message) : "unknown";
        await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "jobs.payment_retry", "Fallo al crear link de pago de respaldo", {
            subscriptionId: args.subscriptionId,
            customerId: args.customerId,
            reason: args.reason,
            originalError: args.originalError || null,
            fallbackError
        }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
            logger_1.logger.warn({ err: logErr, subscriptionId: args.subscriptionId, customerId: args.customerId }, "Fallo escribiendo systemLog por fallback de link");
        });
        throw new Error(`payment_link_fallback_failed:${fallbackError}`);
    }
}
async function paymentRetry(payload) {
    const subscriptionId = String(payload?.subscriptionId || "").trim();
    if (!subscriptionId) {
        throw new Error("subscription_not_found");
    }
    const lockKey = `payment-retry:${subscriptionId}`;
    const lockAcquired = await prisma_1.prisma.$queryRaw `
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) as locked
  `.then(rows => Boolean(rows?.[0]?.locked)).catch(() => false);
    if (!lockAcquired) {
        return { status: "deferred", mode: "MANUAL_LINK", reason: "lock_failed", subscriptionId, nextRunAt: new Date(Date.now() + 60_000) };
    }
    try {
        const sub = await prisma_1.prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true, customer: true } });
        if (!sub)
            throw new Error("subscription_not_found");
        if (sub.status === "CANCELED")
            throw new Error("subscription_canceled");
        if (sub.status === "SUSPENDED")
            return { status: "skipped", mode: "MANUAL_LINK", reason: "subscription_suspended", subscriptionId };
        await (0, billingCycles_1.syncSubscriptionBillingSnapshot)({ subscriptionId }).catch(() => null);
        const billingState = await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId }).catch(() => null);
        // Validar email del cliente (requerido para Wompi)
        if (!sub.customer?.email) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "jobs.payment_retry", "Cliente sin email - imposible cobrar", {
                subscriptionId,
                customerId: sub.customerId
            }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                logger_1.logger.warn({ err: logErr, subscriptionId, customerId: sub.customerId }, "Fallo escribiendo systemLog por cliente sin email");
            });
            throw new Error("customer_email_required");
        }
        // Validar payment source para AUTO_DEBIT
        const collectionMode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(sub);
        if (collectionMode === "AUTO_DEBIT") {
            const hasPaymentSource = hasUsableCustomerPaymentSource(sub.customer.metadata);
            if (!hasPaymentSource) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "jobs.payment_retry", "Cliente sin token - creando link de pago", {
                    subscriptionId,
                    customerId: sub.customerId
                }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, subscriptionId, customerId: sub.customerId }, "Fallo escribiendo systemLog por cliente sin token");
                });
                void (0, realtimePublisher_1.publishRealtime)("payments", {
                    type: "payment_retry_missing_token",
                    subscriptionId,
                    customerId: sub.customerId,
                    updatedAt: new Date().toISOString()
                });
                await createFallbackPaymentLinkOrThrow({
                    subscriptionId,
                    customerId: sub.customerId,
                    reason: "missing_payment_source"
                });
                return {
                    status: "processed",
                    mode: collectionMode,
                    action: "PAYMENT_LINK_CREATED",
                    subscriptionId
                };
            }
        }
        const mode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(sub);
        if (mode === "AUTO_DEBIT" || mode === "AUTO_LINK") {
            const autoDebitConfig = await (0, subscriptionAutomationConfig_1.resolveEffectiveSubscriptionAutomationConfig)(sub).catch(() => (0, runtimeConfig_1.getAutoDebitConfig)());
            const now = new Date();
            const retryWindowMinutes = autoDebitConfig.retryEnabled
                ? (autoDebitConfig.retryEveryMinutes * Math.max(1, autoDebitConfig.maxRetries) * 2)
                : 120;
            const safetyWindowMinutes = Math.max(30, retryWindowMinutes);
            const recentPendingAutoCharge = await prisma_1.prisma.payment.findFirst({
                where: {
                    subscriptionId,
                    status: "PENDING",
                    wompiTransactionId: { not: null },
                    createdAt: { gte: new Date(now.getTime() - safetyWindowMinutes * 60 * 1000) }
                },
                orderBy: { createdAt: "desc" },
                select: { id: true, wompiTransactionId: true, createdAt: true }
            });
            if (recentPendingAutoCharge) {
                if (!autoDebitConfig.retryEnabled) {
                    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "jobs.payment_retry", "Cobro automático omitido: ya existe cobro pendiente y los reintentos están deshabilitados", {
                        subscriptionId,
                        mode,
                        pendingPaymentId: recentPendingAutoCharge.id,
                        wompiTransactionId: recentPendingAutoCharge.wompiTransactionId,
                        pendingCreatedAt: recentPendingAutoCharge.createdAt?.toISOString?.() || recentPendingAutoCharge.createdAt
                    }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                        logger_1.logger.warn({ err: logErr, subscriptionId, pendingPaymentId: recentPendingAutoCharge.id }, "Fallo escribiendo systemLog por cobro pendiente con reintentos deshabilitados");
                    });
                    return {
                        status: "skipped",
                        mode,
                        reason: "pending_charge_exists",
                        subscriptionId
                    };
                }
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "jobs.payment_retry", "Cobro automático omitido: ya existe cobro pendiente reciente", {
                    subscriptionId,
                    mode,
                    pendingPaymentId: recentPendingAutoCharge.id,
                    wompiTransactionId: recentPendingAutoCharge.wompiTransactionId,
                    pendingCreatedAt: recentPendingAutoCharge.createdAt?.toISOString?.() || recentPendingAutoCharge.createdAt
                }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, subscriptionId, pendingPaymentId: recentPendingAutoCharge.id }, "Fallo escribiendo systemLog por cobro pendiente reciente");
                });
                void (0, realtimePublisher_1.publishRealtime)("payments", {
                    type: "payment_retry_skipped_pending",
                    subscriptionId,
                    customerId: sub.customerId,
                    pendingPaymentId: recentPendingAutoCharge.id,
                    updatedAt: new Date().toISOString()
                });
                return {
                    status: "skipped",
                    mode,
                    reason: "pending_charge_exists",
                    subscriptionId
                };
            }
            const dueCycle = billingState?.collectionCycle || null;
            const dueByCutoff = dueCycle?.periodEndAt ? new Date(dueCycle.periodEndAt) : null;
            const dueAt = dueCycle?.dueAt ? new Date(dueCycle.dueAt) : null;
            if (dueAt && now.getTime() + 5_000 < dueAt.getTime()) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "jobs.payment_retry", "Cobro automático omitido: aún no es fecha de cobro", {
                    subscriptionId,
                    mode,
                    dueAt: dueAt.toISOString(),
                    now: now.toISOString(),
                    byCutoff: dueByCutoff ? dueByCutoff.toISOString() : null
                }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, subscriptionId, dueAt }, "Fallo escribiendo systemLog por cobro fuera de fecha");
                });
                void (0, realtimePublisher_1.publishRealtime)("payments", {
                    type: "payment_retry_deferred_not_due",
                    subscriptionId,
                    customerId: sub.customerId,
                    dueAt: dueAt.toISOString(),
                    updatedAt: new Date().toISOString()
                });
                return {
                    status: "deferred",
                    mode,
                    reason: "not_due_yet",
                    subscriptionId,
                    nextRunAt: dueAt
                };
            }
        }
        if (mode === "AUTO_DEBIT") {
            const autoDebitConfig = await (0, subscriptionAutomationConfig_1.resolveEffectiveSubscriptionAutomationConfig)(sub).catch(() => (0, runtimeConfig_1.getAutoDebitConfig)());
            if (!autoDebitConfig.enabled) {
                if (shouldCreateFallbackLinkWhenAutoDebitDisabled()) {
                    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "jobs.payment_retry", "Débito automático deshabilitado; creando link de respaldo", {
                        subscriptionId,
                        source: "settings.auto_debit.enabled"
                    }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                        logger_1.logger.warn({ err: logErr, subscriptionId }, "Fallo escribiendo systemLog por auto debit deshabilitado");
                    });
                    void (0, realtimePublisher_1.publishRealtime)("payments", {
                        type: "payment_retry_auto_debit_disabled",
                        subscriptionId,
                        customerId: sub.customerId,
                        updatedAt: new Date().toISOString()
                    });
                    await createFallbackPaymentLinkOrThrow({
                        subscriptionId,
                        customerId: sub.customerId,
                        reason: "auto_debit_disabled"
                    });
                    return {
                        status: "processed",
                        mode,
                        action: "PAYMENT_LINK_CREATED",
                        subscriptionId
                    };
                }
                return {
                    status: "skipped",
                    mode,
                    reason: "auto_debit_disabled",
                    subscriptionId
                };
            }
            // Tope duro por ciclo. Un cobro declinado no lanza error, así que sin
            // esto el ciclo se vuelve a cobrar en cada pasada del sincronizador.
            const intentos = await (0, collectionAttempts_1.hasExhaustedCycleAttempts)({
                subscriptionId,
                cycleNumber: billingState?.collectionCycle?.cycleNumber ?? null,
                config: autoDebitConfig
            }).catch(() => ({ exhausted: false, attempts: 0, allowed: 1 }));
            if (intentos.exhausted) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "jobs.payment_retry", "Cobro automático detenido: el ciclo agotó sus intentos", {
                    subscriptionId,
                    mode,
                    cycleNumber: billingState?.collectionCycle?.cycleNumber ?? null,
                    attempts: intentos.attempts,
                    allowed: intentos.allowed
                }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, subscriptionId }, "Fallo escribiendo systemLog por intentos agotados");
                });
                return {
                    status: "skipped",
                    mode,
                    reason: "cycle_attempts_exhausted",
                    subscriptionId
                };
            }
            try {
                await (0, subscriptionBilling_1.createAutoDebitTransactionForSubscription)({
                    subscriptionId,
                    forceNewTransaction: false
                });
                void (0, realtimePublisher_1.publishRealtime)("payments", {
                    type: "payment_retry_charge_created",
                    subscriptionId,
                    customerId: sub.customerId,
                    updatedAt: new Date().toISOString()
                });
                return {
                    status: "processed",
                    mode,
                    action: "AUTO_DEBIT_CHARGE",
                    subscriptionId
                };
            }
            catch (err) {
                const msg = err?.message ? String(err.message) : "unknown error";
                const isMissingSource = msg === "customer_payment_source_missing";
                // Log detallado del fallo para debug
                await (0, systemLog_1.systemLog)(isMissingSource ? client_1.LogLevel.WARN : client_1.LogLevel.ERROR, "jobs.payment_retry", isMissingSource ? "Auto-debit sin token; creando link manual" : "Fallo en cobro automático", {
                    subscriptionId,
                    customerId: sub.customerId,
                    error: msg,
                    stack: err?.stack,
                    email: sub.customer?.email,
                    hasPaymentSource: hasUsableCustomerPaymentSource(sub.customer.metadata),
                    collectionMode: mode,
                    subscriptionStatus: sub.status,
                    currentCycle: billingState?.activeCycle?.cycleNumber ?? null,
                    currentPeriodEndAt: billingState?.activeCycle?.periodEndAt?.toISOString?.() || null,
                    errorDetails: err?.details || err?.cause || null,
                    wompiTransactionId: err?.wompiTransactionId || null,
                    reference: err?.reference || null
                }, systemLog_1.SystemActor.JOB_PAYMENT_RETRY).catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, subscriptionId, customerId: sub.customerId }, "Fallo escribiendo systemLog por fallo en cobro automático");
                });
                void (0, realtimePublisher_1.publishRealtime)("payments", {
                    type: isMissingSource ? "payment_retry_missing_token" : "payment_retry_failed",
                    subscriptionId,
                    customerId: sub.customerId,
                    error: msg,
                    updatedAt: new Date().toISOString()
                });
                await createFallbackPaymentLinkOrThrow({
                    subscriptionId,
                    customerId: sub.customerId,
                    reason: isMissingSource ? "missing_payment_source" : "auto_debit_charge_failed",
                    originalError: msg
                });
                if (!isMissingSource)
                    throw err;
                return {
                    status: "processed",
                    mode,
                    action: "PAYMENT_LINK_CREATED",
                    subscriptionId
                };
            }
        }
        await (0, subscriptionBilling_1.createPaymentLinkForSubscription)({ subscriptionId });
        return {
            status: "processed",
            mode: asResultMode(mode),
            action: "PAYMENT_LINK_CREATED",
            subscriptionId
        };
    }
    finally {
        await prisma_1.prisma.$queryRaw `SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch((err) => {
            logger_1.logger.warn({ err, subscriptionId, lockKey }, "Fallo liberando advisory lock de payment retry");
        });
    }
}
