"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSubscriptionTotalInCents = readSubscriptionTotalInCents;
exports.ensureExpiredSubscriptions = ensureExpiredSubscriptions;
exports.handleSubscriptionPaymentFailure = handleSubscriptionPaymentFailure;
exports.createPaymentLinkForSubscription = createPaymentLinkForSubscription;
exports.createAutoDebitTransactionForSubscription = createAutoDebitTransactionForSubscription;
const client_1 = require("@prisma/client");
const prisma_1 = require("../db/prisma");
const client_2 = require("../providers/wompi/client");
const systemLog_1 = require("./systemLog");
const chatwootSync_1 = require("./chatwootSync");
const checkoutConfig_1 = require("./checkoutConfig");
const credentials_1 = require("./credentials");
const notificationDelivery_1 = require("./notificationDelivery");
const logger_1 = require("../lib/logger");
const wompiSignature_1 = require("../lib/wompiSignature");
const runtimeConfig_1 = require("./runtimeConfig");
const notificationsConfig_1 = require("./notificationsConfig");
const notificationsScheduler_1 = require("./notificationsScheduler");
const realtimePublisher_1 = require("./realtimePublisher");
const subscriptionMode_1 = require("./subscriptionMode");
const subscriptionAutomationConfig_1 = require("./subscriptionAutomationConfig");
const wompiReconcile_1 = require("./wompiReconcile");
const metadataSchemas_1 = require("../lib/metadataSchemas");
const billingCycles_1 = require("./billingCycles");
const publicCheckoutLinks_1 = require("./publicCheckoutLinks");
const customerMetadata_1 = require("../lib/customerMetadata");
const PAYMENT_LINK_LOCK_PREFIX = "payment-link";
const AUTO_DEBIT_LOCK_PREFIX = "auto-debit";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logIgnored = (err, message, context) => {
    logger_1.logger.warn({ err, ...(context || {}) }, message);
};
function readSubscriptionTemplateId(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
        return "";
    return String(metadata.templateId || "").trim();
}
function readPlanCatalogItemId(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
        return "";
    const catalog = metadata.catalog;
    return String(catalog?.itemId || "").trim();
}
function readTemplateProductRefs(value) {
    return Array.isArray(value) ? value : [];
}
function extractTemplateProductId(entry) {
    if (!entry)
        return "";
    if (typeof entry === "string")
        return String(entry).trim();
    if (typeof entry === "object")
        return String(entry.id || "").trim();
    return "";
}
function resolveSubscriptionProductId(args) {
    const direct = String(args.subscriptionProductId || "").trim();
    if (direct)
        return direct;
    const catalogProductId = String(args.planCatalogProductId || "").trim();
    if (catalogProductId)
        return catalogProductId;
    const fromMeta = readPlanCatalogItemId(args.planMetadata);
    return fromMeta || null;
}
function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
async function tryAcquirePaymentLinkLock(key) {
    try {
        const rows = await prisma_1.prisma.$queryRaw `
      SELECT pg_try_advisory_lock(hashtext(${key})) as locked
    `;
        return Boolean(rows?.[0]?.locked);
    }
    catch (err) {
        logger_1.logger.warn({ err, key, error: getErrorMessage(err) }, '[PaymentLock] Failed to acquire lock');
        throw err; // Re-lanzar para que el caller sepa que falló
    }
}
async function releasePaymentLinkLock(key) {
    try {
        await prisma_1.prisma.$queryRaw `
      SELECT pg_advisory_unlock(hashtext(${key}))
    `;
    }
    catch (err) {
        logger_1.logger.warn({ err, key, error: getErrorMessage(err) }, '[PaymentLock] Failed to release lock');
    }
}
function formatCop(amountInCents) {
    const pesos = Math.trunc(Number(amountInCents ?? 0) / 100);
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}
function formatPeriodicity(intervalUnit, intervalCount) {
    const count = Number(intervalCount || 1);
    const unit = String(intervalUnit || "MONTH").toUpperCase();
    if (unit === "DAY")
        return count === 1 ? "diaria" : `cada ${count} días`;
    if (unit === "WEEK")
        return count === 1 ? "semanal" : `cada ${count} semanas`;
    if (unit === "MONTH")
        return count === 1 ? "mensual" : `cada ${count} meses`;
    return count === 1 ? "periódica" : `cada ${count} periodos`;
}
function replaceVars(input, vars) {
    return input
        .replaceAll("{contacto}", vars.contacto)
        .replaceAll("{producto}", vars.producto)
        .replaceAll("{monto}", vars.monto)
        .replaceAll("{periodicidad}", vars.periodicidad)
        .replaceAll("{fecha_expira}", vars.fecha_expira);
}
async function resolvePlanCheckoutTemplateId(args) {
    const tenantId = String(args.tenantId || "").trim();
    if (!tenantId)
        return null;
    const explicitTemplateId = readSubscriptionTemplateId(args.subscriptionMetadata);
    if (explicitTemplateId) {
        const explicit = await prisma_1.prisma.publicCheckoutTemplate.findUnique({ where: { id: explicitTemplateId } }).catch(() => null);
        if (explicit && explicit.active !== false && String(explicit.kind || "").toUpperCase() === "PLAN") {
            return String(explicit.id);
        }
    }
    const productId = readPlanCatalogItemId(args.planMetadata);
    const templates = await prisma_1.prisma.publicCheckoutTemplate.findMany({
        where: { tenantId, active: true, kind: "PLAN" },
        orderBy: { updatedAt: "desc" }
    });
    if (!templates.length)
        return null;
    if (productId) {
        const match = templates.find((t) => {
            const list = readTemplateProductRefs(t.productIds);
            return list.some((entry) => String(extractTemplateProductId(entry)) === productId);
        });
        if (match?.id)
            return String(match.id);
    }
    try {
        const rawCfg = await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "CHECKOUT_CONFIG");
        const cfg = (0, checkoutConfig_1.readCheckoutConfig)(rawCfg);
        const defaultTemplateId = String(cfg?.defaultPlanTemplateId || "").trim();
        if (!defaultTemplateId)
            return null;
        const fallback = templates.find((t) => String(t.id || "").trim() === defaultTemplateId) || null;
        return fallback?.id ? String(fallback.id) : null;
    }
    catch {
        return null;
    }
}
async function hasUsableSubscriptionPaymentLinkNotification() {
    try {
        const cfg = await (0, notificationsConfig_1.getNotificationsConfig)();
        const template = (0, notificationsConfig_1.resolveNotificationTemplate)({
            rules: cfg.rules,
            templates: cfg.templates,
            trigger: "PAYMENT_LINK_CREATED",
            paymentType: "SUBSCRIPTION"
        });
        return Boolean(template &&
            String(template.channel || "").toUpperCase() === "CHATWOOT" &&
            String(template.chatwootTemplate?.name || "").trim());
    }
    catch {
        return false;
    }
}
function readSubscriptionTotalInCents(subscriptionMeta, fallback, planMeta) {
    return (0, metadataSchemas_1.getExpectedSubscriptionTotalInCents)({
        subscriptionMetadata: subscriptionMeta,
        planMetadata: planMeta,
        fallback
    });
}
/**
 * Determines if a subscription should be considered past due.
 * RULE: If the most recent cycle is paid, subscription is ACTIVE even if older cycles are overdue.
 */
function shouldMarkSubscriptionPastDue(args) {
    const cycle = args.mostRecentCycle;
    if (!cycle)
        return { shouldMark: false, reason: "no_cycle" };
    // KEY RULE: subscription is ACTIVE only when the most recent cycle is actually PAID.
    if ((0, billingCycles_1.isBillingCyclePaid)(cycle))
        return { shouldMark: false, reason: "most_recent_cycle_is_paid" };
    const dueWithGraceAt = new Date(cycle.dueAt.getTime() + Math.max(0, Math.trunc(args.graceDays || 0)) * 24 * 60 * 60 * 1000);
    if (dueWithGraceAt.getTime() >= args.asOf.getTime()) {
        return { shouldMark: false, reason: "within_due_or_grace_period" };
    }
    return { shouldMark: true, reason: "most_recent_cycle_overdue" };
}
async function ensureExpiredSubscriptions() {
    const now = new Date();
    const candidates = await prisma_1.prisma.subscription.findMany({
        where: {
            status: { in: [client_1.SubscriptionStatus.ACTIVE, client_1.SubscriptionStatus.PAST_DUE, client_1.SubscriptionStatus.SUSPENDED, client_1.SubscriptionStatus.EXPIRED] }
        },
        select: {
            id: true,
            status: true,
            graceDays: true,
            maxRetries: true,
            metadata: true
        }
    });
    let toPastDue = 0;
    let recoveredToActive = 0;
    for (const sub of candidates) {
        const automation = await (0, subscriptionAutomationConfig_1.resolveEffectiveSubscriptionAutomationConfig)(sub).catch(() => null);
        const graceDays = Math.max(0, Math.trunc(Number(automation?.graceDays ?? 5)));
        const billingState = await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: sub.id }).catch(() => null);
        const collectionCycle = billingState?.collectionCycle || billingState?.activeCycle || null;
        // Check if subscription should be PAST_DUE
        const pastDueCheck = shouldMarkSubscriptionPastDue({
            mostRecentCycle: collectionCycle,
            graceDays,
            asOf: now
        });
        // SUSPENDED/EXPIRED lifecycle is disabled: recover those subscriptions back into the billing flow.
        if (sub.status === client_1.SubscriptionStatus.SUSPENDED || sub.status === client_1.SubscriptionStatus.EXPIRED) {
            await prisma_1.prisma.subscription.update({
                where: { id: sub.id },
                data: {
                    status: (0, billingCycles_1.isBillingCyclePaid)(collectionCycle) ? client_1.SubscriptionStatus.ACTIVE : client_1.SubscriptionStatus.PAST_DUE,
                    suspendedAt: null,
                    canceledAt: null
                }
            });
            recoveredToActive += 1;
            continue;
        }
        // CRITICAL: If most recent cycle is paid but subscription is PAST_DUE, recover to ACTIVE
        if (sub.status === client_1.SubscriptionStatus.PAST_DUE && (0, billingCycles_1.isBillingCyclePaid)(collectionCycle)) {
            await prisma_1.prisma.subscription.update({
                where: { id: sub.id },
                data: { status: client_1.SubscriptionStatus.ACTIVE, suspendedAt: null, canceledAt: null }
            });
            recoveredToActive += 1;
            continue;
        }
        if (sub.status === client_1.SubscriptionStatus.ACTIVE && pastDueCheck.shouldMark) {
            await prisma_1.prisma.subscription.update({
                where: { id: sub.id },
                data: { status: client_1.SubscriptionStatus.PAST_DUE }
            });
            toPastDue += 1;
        }
    }
    if (toPastDue > 0 || recoveredToActive > 0) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "subscriptions.lifecycle", "Limpieza de estados de suscripciones", {
            markedPastDue: toPastDue,
            recoveredToActive
        }).catch((err) => {
            logIgnored(err, "subscription lifecycle: failed to write cleanup log", { toPastDue, recoveredToActive });
        });
    }
}
async function handleSubscriptionPaymentFailure(subscriptionId, error) {
    const sub = await prisma_1.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: {
            id: true,
            status: true,
            graceDays: true,
            maxRetries: true,
            metadata: true
        }
    });
    if (!sub || sub.status === client_1.SubscriptionStatus.CANCELED)
        return;
    const automation = await (0, subscriptionAutomationConfig_1.resolveEffectiveSubscriptionAutomationConfig)(sub).catch(() => null);
    const graceDays = Math.max(0, Math.trunc(Number(automation?.graceDays ?? 5)));
    const billingState = await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: sub.id }).catch(() => null);
    const mostRecentCycle = billingState?.collectionCycle || billingState?.activeCycle || null;
    // KEY RULE: If most recent cycle is paid, don't mark subscription as PAST_DUE
    if ((0, billingCycles_1.isBillingCyclePaid)(mostRecentCycle)) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "subscriptions.lifecycle", "Cobro falló pero el ciclo más reciente está pagado", {
            subscriptionId,
            error,
            mostRecentCycle: mostRecentCycle?.cycleNumber ?? null,
            currentStatus: sub.status
        }).catch((err) => {
            logIgnored(err, "subscription lifecycle: failed to write grace-period failure log", { subscriptionId });
        });
        return;
    }
    if (!mostRecentCycle)
        return;
    const dueWithGraceAt = new Date(mostRecentCycle.dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
    if (dueWithGraceAt.getTime() >= Date.now()) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "subscriptions.lifecycle", "Cobro falló pero la suscripción sigue dentro de gracia", {
            subscriptionId,
            error,
            dueAt: mostRecentCycle.dueAt.toISOString(),
            dueWithGraceAt: dueWithGraceAt.toISOString(),
            currentStatus: sub.status
        }).catch((err) => {
            logIgnored(err, "subscription lifecycle: failed to write grace-period failure log", { subscriptionId });
        });
        return;
    }
    await prisma_1.prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: client_1.SubscriptionStatus.PAST_DUE }
    });
    await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "subscriptions.lifecycle", "Suscripción marcada como PAST_DUE tras fallo de cobro", {
        subscriptionId,
        error,
        dueAt: mostRecentCycle.dueAt.toISOString(),
        dueWithGraceAt: dueWithGraceAt.toISOString(),
        previousStatus: sub.status
    }).catch((err) => {
        logIgnored(err, "subscription lifecycle: failed to write past_due log", { subscriptionId });
    });
}
async function createPaymentLinkForSubscription(args) {
    const emptyNotificationResult = {
        notificationsScheduled: 0,
        notificationsSent: 0,
        notificationsRulesActive: false,
        chatwootError: null
    };
    const sub = await prisma_1.prisma.subscription.findUnique({
        where: { id: args.subscriptionId },
        include: { plan: true, customer: true }
    });
    if (!sub)
        throw new Error("subscription_not_found");
    const tenantId = sub.tenantId || sub.plan?.tenantId;
    if (!tenantId)
        throw new Error("tenant_required");
    if (sub.status === client_1.SubscriptionStatus.CANCELED)
        throw new Error("subscription_canceled");
    if (sub.status === client_1.SubscriptionStatus.SUSPENDED)
        throw new Error("subscription_suspended");
    if (sub.status === client_1.SubscriptionStatus.EXPIRED)
        throw new Error("subscription_expired");
    // FIX: Validar moneda antes de crear payment link
    const currency = (0, wompiSignature_1.validateWompiCurrency)(sub.plan.currency);
    const billingState = await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: sub.id }).catch((err) => {
        logIgnored(err, "payment link: failed to resolve billing state", { subscriptionId: sub.id });
        return null;
    });
    const collectionCycle = billingState?.collectionCycle || null;
    if ((0, billingCycles_1.isBillingCyclePaid)(collectionCycle)) {
        throw new Error("payment_already_approved");
    }
    // Si no hay ciclo de cobro resuelto se usa el vigente. Caer al ciclo 1 dejaba
    // el pago colgado de un ciclo que ya no se está cobrando.
    const cycle = collectionCycle?.cycleNumber ?? billingState?.activeCycle?.cycleNumber ?? 1;
    let reference = `SUB_${sub.id}_${cycle}`;
    const amountInCents = args.amountInCentsOverride ?? readSubscriptionTotalInCents(sub.metadata, sub.plan.priceInCents, sub.plan.metadata);
    const subscriptionCycleKey = `${sub.id}:${cycle}`;
    const existingPayment = await prisma_1.prisma.payment.findUnique({
        where: { subscriptionCycleKey },
        select: {
            id: true,
            status: true,
            checkoutUrl: true,
            wompiPaymentLinkId: true
        }
    });
    if (existingPayment && existingPayment.status === client_1.PaymentStatus.APPROVED) {
        throw new Error("payment_already_approved");
    }
    const payment = await prisma_1.prisma.payment.upsert({
        where: { subscriptionCycleKey },
        create: {
            tenantId,
            customerId: sub.customerId,
            subscriptionId: sub.id,
            amountInCents,
            currency,
            cycleNumber: cycle,
            reference,
            status: client_1.PaymentStatus.PENDING,
            subscriptionCycleKey,
            origin: "AUTO_LINK",
            associationReason: "SUB_REF",
            associatedBy: "system"
        },
        update: {
            tenantId,
            customerId: sub.customerId,
            subscriptionId: sub.id,
            amountInCents,
            currency,
            cycleNumber: cycle,
            subscriptionCycleKey,
            origin: "AUTO_LINK",
            associationReason: "SUB_REF",
            associatedBy: "system",
            reference,
            status: client_1.PaymentStatus.PENDING
        }
    });
    if (payment.checkoutUrl && payment.wompiPaymentLinkId) {
        await prisma_1.prisma.paymentLink
            .upsert({
            where: { paymentId: payment.id },
            create: {
                tenantId,
                planId: sub.planId,
                subscriptionId: sub.id,
                paymentId: payment.id,
                wompiPaymentLinkId: payment.wompiPaymentLinkId,
                checkoutUrl: payment.checkoutUrl,
                status: payment.status === client_1.PaymentStatus.APPROVED ? client_1.PaymentLinkStatus.PAID : client_1.PaymentLinkStatus.SENT,
                sentAt: new Date(),
                paidAt: payment.paidAt ?? null
            },
            update: {
                tenantId,
                planId: sub.planId,
                subscriptionId: sub.id,
                wompiPaymentLinkId: payment.wompiPaymentLinkId,
                checkoutUrl: payment.checkoutUrl,
                paidAt: payment.paidAt ?? null,
                status: payment.status === client_1.PaymentStatus.APPROVED ? client_1.PaymentLinkStatus.PAID : undefined
            }
        })
            .catch((err) => {
            logIgnored(err, "payment link: failed to upsert existing link", { subscriptionId: sub.id, paymentId: payment.id });
        });
        return {
            paymentId: payment.id,
            wompiPaymentLinkId: payment.wompiPaymentLinkId,
            checkoutUrl: payment.checkoutUrl,
            ...emptyNotificationResult
        };
    }
    const lockKey = `${PAYMENT_LINK_LOCK_PREFIX}:${subscriptionCycleKey}`;
    const locked = await tryAcquirePaymentLinkLock(lockKey);
    if (!locked) {
        for (let attempt = 0; attempt < 4; attempt++) {
            await delay(250);
            const existing = await prisma_1.prisma.payment.findUnique({
                where: { id: payment.id },
                select: { checkoutUrl: true, wompiPaymentLinkId: true }
            });
            if (existing?.checkoutUrl && existing?.wompiPaymentLinkId) {
                return {
                    paymentId: payment.id,
                    wompiPaymentLinkId: existing.wompiPaymentLinkId,
                    checkoutUrl: existing.checkoutUrl,
                    ...emptyNotificationResult
                };
            }
        }
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "subscriptions.payment_link", "Payment link creation already in progress", {
            subscriptionId: sub.id,
            paymentId: payment.id
        }).catch((err) => {
            logIgnored(err, "payment link: failed to write system log", { subscriptionId: sub.id, paymentId: payment.id });
        });
        throw new Error("payment_link_in_progress");
    }
    let lockReleased = false;
    const releaseLock = async () => {
        if (lockReleased)
            return;
        lockReleased = true;
        await releasePaymentLinkLock(lockKey).catch((err) => {
            logIgnored(err, "payment link: failed to release advisory lock", { lockKey });
        });
    };
    let created;
    let updated = null;
    try {
        const existing = await prisma_1.prisma.payment.findUnique({
            where: { id: payment.id },
            select: { checkoutUrl: true, wompiPaymentLinkId: true }
        });
        if (existing?.checkoutUrl && existing?.wompiPaymentLinkId) {
            await releaseLock();
            return {
                paymentId: payment.id,
                wompiPaymentLinkId: existing.wompiPaymentLinkId,
                checkoutUrl: existing.checkoutUrl,
                ...emptyNotificationResult
            };
        }
        const privateKey = await (0, runtimeConfig_1.getWompiPrivateKey)();
        if (!privateKey)
            throw new Error("wompi_private_key_not_configured");
        const wompi = new client_2.WompiClient({
            apiBaseUrl: await (0, runtimeConfig_1.getWompiApiBaseUrl)(),
            privateKey,
            checkoutLinkBaseUrl: await (0, runtimeConfig_1.getWompiCheckoutLinkBaseUrl)()
        });
        try {
            const redirectUrl = await (0, runtimeConfig_1.getWompiRedirectUrl)();
            const periodicidad = formatPeriodicity(sub.plan.intervalUnit, sub.plan.intervalCount);
            const monto = formatCop(amountInCents);
            const cliente = sub.customer?.name || sub.customer?.email || "Cliente";
            const producto = sub.plan?.name || "Suscripción";
            const rawConfig = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
            const cfg = rawConfig ? (0, checkoutConfig_1.readCheckoutConfig)(rawConfig) : null;
            const collectionMode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(sub);
            // Solo AUTO_DEBIT usa plantilla SUBSCRIPTION; MANUAL_LINK y AUTO_LINK usan PLAN
            const isPlan = collectionMode !== "AUTO_DEBIT";
            const baseTitle = String(isPlan ? cfg?.planTitle : cfg?.subscriptionTitle || "").trim();
            const baseDesc = String(isPlan ? cfg?.planDescription : cfg?.subscriptionDescription || "").trim();
            const templateId = readSubscriptionTemplateId(sub.metadata);
            const template = templateId
                ? await prisma_1.prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
                : null;
            const templateOk = template &&
                String(template.kind || "").toUpperCase() === (isPlan ? "PLAN" : "SUBSCRIPTION")
                ? template
                : null;
            const templateTitle = String(templateOk?.publicTitle || templateOk?.wompiTitle || baseTitle || "").trim();
            const templateDesc = String(templateOk?.publicDescription || templateOk?.wompiDescription || baseDesc || "").trim();
            const vars = {
                contacto: cliente,
                producto,
                monto,
                periodicidad,
                fecha_expira: ""
            };
            const wompiTitle = templateTitle ? replaceVars(templateTitle, vars) : `${producto} · ${cliente}`;
            const wompiDescription = templateDesc ? replaceVars(templateDesc, vars) : `${producto} (${periodicidad}) · ${monto} · ciclo ${cycle}`;
            created = await wompi.createPaymentLink({
                name: wompiTitle,
                description: wompiDescription,
                single_use: true,
                collect_shipping: false,
                currency,
                amount_in_cents: amountInCents,
                redirect_url: redirectUrl,
                sku: payment.id
            });
        }
        catch (err) {
            const errMessage = getErrorMessage(err);
            await prisma_1.prisma.paymentAttempt.create({
                data: {
                    paymentId: payment.id,
                    attemptNo: 0,
                    reference,
                    status: "PAYMENT_LINK_CREATE_FAILED",
                    provider: "wompi",
                    errorMessage: errMessage
                }
            });
            await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
                subscriptionId: sub.id,
                paymentId: payment.id,
                err: errMessage
            }).catch((logErr) => {
                logIgnored(logErr, "payment link: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
            });
            throw err;
        }
        await prisma_1.prisma.paymentAttempt.create({
            data: {
                paymentId: payment.id,
                attemptNo: 0,
                reference,
                status: "PAYMENT_LINK_CREATED",
                provider: "wompi",
                response: created.raw
            }
        });
        updated = await prisma_1.prisma.payment.update({
            where: { id: payment.id },
            data: {
                wompiPaymentLinkId: created.id,
                checkoutUrl: created.checkoutUrl
            }
        });
        const updatedPayment = updated ?? {
            id: payment.id,
            checkoutUrl: created.checkoutUrl,
            wompiPaymentLinkId: created.id
        };
        const updatedId = updatedPayment.id;
        await prisma_1.prisma.paymentLink
            .upsert({
            where: { paymentId: updatedPayment.id },
            create: {
                tenantId,
                planId: sub.planId,
                productId: resolveSubscriptionProductId({
                    subscriptionProductId: sub.productId,
                    planCatalogProductId: sub.plan?.catalogProductId || null,
                    planMetadata: sub.plan?.metadata
                }),
                subscriptionId: sub.id,
                paymentId: updatedPayment.id,
                wompiPaymentLinkId: created.id,
                checkoutUrl: updatedPayment.checkoutUrl || created.checkoutUrl,
                status: client_1.PaymentLinkStatus.SENT,
                sentAt: new Date()
            },
            update: {
                tenantId,
                planId: sub.planId,
                productId: resolveSubscriptionProductId({
                    subscriptionProductId: sub.productId,
                    planCatalogProductId: sub.plan?.catalogProductId || null,
                    planMetadata: sub.plan?.metadata
                }),
                subscriptionId: sub.id,
                wompiPaymentLinkId: created.id,
                checkoutUrl: updatedPayment.checkoutUrl || created.checkoutUrl
            }
        })
            .catch((err) => {
            logIgnored(err, "payment link: failed to upsert payment link", { subscriptionId: sub.id, paymentId: updatedId });
        });
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "subscriptions.payment_link", "Payment link created", {
            subscriptionId: sub.id,
            paymentId: updatedId,
            wompiPaymentLinkId: created.id
        }).catch((err) => {
            logIgnored(err, "payment link: failed to write system log", { subscriptionId: sub.id, paymentId: updatedId });
        });
        void (0, realtimePublisher_1.publishRealtime)("payments", {
            type: "payment_link_created",
            subscriptionId: sub.id,
            paymentId: updatedId,
            wompiPaymentLinkId: created.id,
            status: updated?.status || client_1.PaymentStatus.PENDING,
            amountInCents: updated?.amountInCents,
            customerId: sub.customerId,
            checkoutUrl: updated?.checkoutUrl || created.checkoutUrl || null,
            createdAt: new Date().toISOString()
        });
    }
    finally {
        await releaseLock();
    }
    if (!updated || !created) {
        throw new Error("payment_link_not_created");
    }
    if (args.sendNotifications === false) {
        if (!updated.checkoutUrl)
            throw new Error("checkout_url_missing");
        return {
            paymentId: updated.id,
            wompiPaymentLinkId: created.id,
            checkoutUrl: updated.checkoutUrl,
            ...emptyNotificationResult
        };
    }
    const shouldNotify = await hasUsableSubscriptionPaymentLinkNotification();
    if (!shouldNotify) {
        if (!updated.checkoutUrl)
            throw new Error("checkout_url_missing");
        return {
            paymentId: updated.id,
            wompiPaymentLinkId: created.id,
            checkoutUrl: updated.checkoutUrl,
            ...emptyNotificationResult
        };
    }
    const publicTemplateId = await resolvePlanCheckoutTemplateId({
        tenantId,
        subscriptionMetadata: sub.metadata,
        planMetadata: sub.plan?.metadata
    }).catch(() => null);
    if (!publicTemplateId) {
        throw new Error("missing_checkout_for_product");
    }
    const publicCheckout = await (0, publicCheckoutLinks_1.createPublicCheckoutLink)({
        customerId: sub.customerId,
        templateId: publicTemplateId,
        checkoutUrl: updated.checkoutUrl
    }).catch((err) => {
        logIgnored(err, "payment link: failed to create public checkout before notifications", {
            subscriptionId: sub.id,
            paymentId: updated.id,
            templateId: publicTemplateId
        });
        return null;
    });
    if (!publicCheckout?.url) {
        throw new Error("public_checkout_create_failed");
    }
    await (0, publicCheckoutLinks_1.persistPublicPaymentLinkForPayment)({
        paymentId: updated.id,
        publicCheckout,
        checkoutUrl: updated.checkoutUrl,
        productId: String(sub?.productId || "") ||
            String(sub?.plan?.catalogProductId || sub?.plan?.metadata?.catalog?.itemId || "") ||
            null,
        amountInCents: updated.amountInCents
    }).catch((err) => {
        logIgnored(err, "payment link: failed to persist public checkout on payment", {
            subscriptionId: sub.id,
            paymentId: updated.id
        });
    });
    const scheduledInfo = await (0, notificationsScheduler_1.schedulePaymentLinkNotifications)({
        paymentId: updated.id,
        paymentLinkUrl: String(publicCheckout?.url || "").trim() || undefined,
        forceNow: true
    }).catch((err) => {
        logIgnored(err, "payment link: failed to schedule notifications", { paymentId: updated.id });
        return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
    });
    const chatwootError = (0, notificationDelivery_1.firstNotificationDeliveryError)(scheduledInfo) || null;
    const chatwoot = await (0, runtimeConfig_1.getChatwootConfig)();
    if (chatwoot.configured) {
        await (0, chatwootSync_1.syncChatwootAttributesForCustomer)(sub.customerId).catch((err) => {
            logIgnored(err, "payment link: failed to sync chatwoot attributes", { customerId: sub.customerId });
        });
    }
    if (!updated.checkoutUrl)
        throw new Error("checkout_url_missing");
    return {
        paymentId: updated.id,
        wompiPaymentLinkId: created.id,
        checkoutUrl: updated.checkoutUrl,
        notificationsScheduled: scheduledInfo?.scheduled ?? 0,
        notificationsSent: scheduledInfo?.sentNow ?? 0,
        notificationsRulesActive: scheduledInfo?.rulesActive ?? false,
        chatwootError
    };
}
async function createAutoDebitTransactionForSubscription(args) {
    const sub = await prisma_1.prisma.subscription.findUnique({
        where: { id: args.subscriptionId },
        include: { plan: true, customer: true }
    });
    if (!sub)
        throw new Error("subscription_not_found");
    const tenantId = sub.tenantId || sub.plan?.tenantId;
    if (!tenantId)
        throw new Error("tenant_required");
    if (sub.status === client_1.SubscriptionStatus.CANCELED)
        throw new Error("subscription_canceled");
    if (sub.status === client_1.SubscriptionStatus.SUSPENDED)
        throw new Error("subscription_suspended");
    if (sub.status === client_1.SubscriptionStatus.EXPIRED)
        throw new Error("subscription_expired");
    const collectionMode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(sub);
    if (collectionMode !== "AUTO_DEBIT") {
        throw new Error("auto_debit_not_allowed_for_collection_mode");
    }
    // FIX: Validar email PRIMERO (Wompi lo requiere para transacciones)
    if (!sub.customer.email) {
        throw new Error("customer_email_required");
    }
    const paymentSourceId = (0, customerMetadata_1.extractCustomerPaymentSourceId)(sub.customer.metadata);
    if (paymentSourceId === null)
        throw new Error("customer_payment_source_missing");
    const overrideCycle = Number.isFinite(args.cycleNumberOverride)
        ? Math.max(1, Math.trunc(args.cycleNumberOverride))
        : null;
    const billingState = await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: sub.id }).catch((err) => {
        logIgnored(err, "auto debit: failed to resolve billing state", { subscriptionId: sub.id });
        return null;
    });
    const inferredCycle = billingState?.collectionCycle?.cycleNumber ?? 1;
    const cycle = overrideCycle ?? inferredCycle;
    let reference = `SUB_${sub.id}_${cycle}`;
    const amountInCents = Math.trunc(args.amountInCentsOverride ?? readSubscriptionTotalInCents(sub.metadata, sub.plan.priceInCents, sub.plan.metadata));
    const currency = (0, wompiSignature_1.validateWompiCurrency)(sub.plan.currency);
    const subscriptionCycleKey = `${sub.id}:${cycle}`;
    const manualInitiator = String(args.initiatedBy || "").trim();
    const paymentOrigin = manualInitiator ? "MANUAL_USER" : "AUTO_DEBIT";
    const associatedBy = manualInitiator || "system";
    const existingApproved = await prisma_1.prisma.payment.findFirst({
        where: { subscriptionId: sub.id, cycleNumber: cycle, status: client_1.PaymentStatus.APPROVED },
        select: { id: true, wompiTransactionId: true }
    });
    if (existingApproved) {
        throw new Error("payment_already_approved");
    }
    if (!args.forceNewTransaction) {
        const existingByCycle = await prisma_1.prisma.payment.findUnique({
            where: { subscriptionCycleKey },
            select: { id: true, status: true, wompiTransactionId: true, reference: true }
        });
        if (existingByCycle?.wompiTransactionId && existingByCycle.status === client_1.PaymentStatus.PENDING) {
            // Intentar reconciliar para no quedarnos pegados en un pending viejo.
            await (0, wompiReconcile_1.reconcileWompiTransaction)({
                wompiTransactionId: existingByCycle.wompiTransactionId,
                tenantId,
                checksumPrefix: "auto-debit-precheck"
            }).catch((err) => {
                logIgnored(err, "auto debit: failed reconcile precheck", { subscriptionId: sub.id, paymentId: existingByCycle.id });
            });
            const refreshed = await prisma_1.prisma.payment.findUnique({
                where: { id: existingByCycle.id },
                select: { status: true, wompiTransactionId: true, reference: true }
            });
            if (refreshed?.status && refreshed.status !== client_1.PaymentStatus.PENDING) {
                if (refreshed.status === client_1.PaymentStatus.APPROVED && refreshed.wompiTransactionId) {
                    return { paymentId: existingByCycle.id, wompiTransactionId: refreshed.wompiTransactionId };
                }
                // Si falló, permitimos crear un nuevo intento abajo.
            }
            else {
                return { paymentId: existingByCycle.id, wompiTransactionId: existingByCycle.wompiTransactionId };
            }
        }
        // If previous transaction was DECLINED/ERROR, compute a unique retry reference to avoid Wompi duplicate errors
        if (existingByCycle?.wompiTransactionId && existingByCycle.status !== client_1.PaymentStatus.PENDING && existingByCycle.status !== client_1.PaymentStatus.APPROVED) {
            const attemptCount = await prisma_1.prisma.paymentAttempt.count({ where: { paymentId: existingByCycle.id } });
            const retrySuffix = `R${Math.max(1, attemptCount + 1)}`;
            reference = `${reference}_${retrySuffix}`;
        }
    }
    let payment;
    if (args.forceNewTransaction) {
        const attemptCount = await prisma_1.prisma.payment.count({ where: { subscriptionId: sub.id, cycleNumber: cycle } });
        const retrySuffix = `R${Math.max(1, attemptCount + 1)}`;
        reference = `${reference}_${retrySuffix}`;
        payment = await prisma_1.prisma.payment.create({
            data: {
                tenantId,
                customerId: sub.customerId,
                subscriptionId: sub.id,
                amountInCents,
                currency,
                cycleNumber: cycle,
                reference,
                status: client_1.PaymentStatus.PENDING,
                subscriptionCycleKey: null,
                origin: paymentOrigin,
                associationReason: "SUB_REF",
                associatedBy
            },
            select: { id: true, wompiTransactionId: true, status: true, reference: true }
        });
    }
    else {
        payment = await prisma_1.prisma.payment.upsert({
            where: { subscriptionCycleKey },
            create: {
                tenantId,
                customerId: sub.customerId,
                subscriptionId: sub.id,
                amountInCents,
                currency,
                cycleNumber: cycle,
                reference,
                status: client_1.PaymentStatus.PENDING,
                subscriptionCycleKey,
                origin: paymentOrigin,
                associationReason: "SUB_REF",
                associatedBy
            },
            update: {
                tenantId,
                amountInCents,
                currency,
                reference,
                status: client_1.PaymentStatus.PENDING,
                wompiTransactionId: null,
                failedAt: null
            },
            select: { id: true, wompiTransactionId: true, status: true, reference: true }
        });
    }
    if (payment.wompiTransactionId && !args.forceNewTransaction) {
        if (payment.status === client_1.PaymentStatus.PENDING) {
            return { paymentId: payment.id, wompiTransactionId: payment.wompiTransactionId };
        }
        if (payment.status === client_1.PaymentStatus.APPROVED) {
            throw new Error("payment_already_approved");
        }
        const attemptCount = await prisma_1.prisma.paymentAttempt.count({
            where: { paymentId: payment.id }
        });
        const retrySuffix = `R${Math.max(1, attemptCount + 1)}`;
        const nextReference = `${reference}_${retrySuffix}`;
        reference = nextReference;
        await prisma_1.prisma.payment.update({
            where: { id: payment.id },
            data: {
                reference: nextReference,
                wompiTransactionId: null,
                providerResponse: payment.providerResponse && typeof payment.providerResponse === "object"
                    ? {
                        ...payment.providerResponse,
                        retry: {
                            previousReference: payment.reference,
                            previousWompiTransactionId: payment.wompiTransactionId,
                            retriedAt: new Date().toISOString()
                        }
                    }
                    : {
                        retry: {
                            previousReference: payment.reference,
                            previousWompiTransactionId: payment.wompiTransactionId,
                            retriedAt: new Date().toISOString()
                        }
                    }
            }
        });
    }
    if (payment.wompiTransactionId && args.forceNewTransaction) {
        const attemptCount = await prisma_1.prisma.paymentAttempt.count({
            where: { paymentId: payment.id }
        });
        const retrySuffix = `R${Math.max(1, attemptCount + 1)}`;
        const nextReference = `${reference}_${retrySuffix}`;
        reference = nextReference;
        await prisma_1.prisma.payment.update({
            where: { id: payment.id },
            data: {
                reference: nextReference,
                wompiTransactionId: null,
                providerResponse: payment.providerResponse && typeof payment.providerResponse === "object"
                    ? {
                        ...payment.providerResponse,
                        retry: {
                            previousReference: payment.reference,
                            previousWompiTransactionId: payment.wompiTransactionId,
                            retriedAt: new Date().toISOString()
                        }
                    }
                    : {
                        retry: {
                            previousReference: payment.reference,
                            previousWompiTransactionId: payment.wompiTransactionId,
                            retriedAt: new Date().toISOString()
                        }
                    }
            }
        });
    }
    const lockKey = `${AUTO_DEBIT_LOCK_PREFIX}:${subscriptionCycleKey}`;
    const locked = await tryAcquirePaymentLinkLock(lockKey);
    if (!locked) {
        for (let attempt = 0; attempt < 6; attempt++) {
            await delay(250);
            const existing = await prisma_1.prisma.payment.findUnique({
                where: { id: payment.id },
                select: { wompiTransactionId: true, status: true }
            });
            if (existing?.wompiTransactionId && existing.status === client_1.PaymentStatus.PENDING) {
                return { paymentId: payment.id, wompiTransactionId: existing.wompiTransactionId };
            }
            if (existing?.status === client_1.PaymentStatus.APPROVED) {
                throw new Error("payment_already_approved");
            }
        }
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "subscriptions.auto_debit", "Auto debit already in progress", {
            subscriptionId: sub.id,
            paymentId: payment.id
        }).catch((err) => {
            logIgnored(err, "auto debit: failed to write in-progress log", { subscriptionId: sub.id, paymentId: payment.id });
        });
        throw new Error("auto_debit_in_progress");
    }
    let lockReleased = false;
    const releaseLock = async () => {
        if (lockReleased)
            return;
        lockReleased = true;
        await releasePaymentLinkLock(lockKey).catch((err) => {
            logIgnored(err, "auto debit: failed to release advisory lock", { lockKey });
        });
    };
    const privateKey = await (0, runtimeConfig_1.getWompiPrivateKey)();
    if (!privateKey) {
        await releaseLock();
        throw new Error("wompi_private_key_not_configured");
    }
    const integritySecret = await (0, runtimeConfig_1.getWompiIntegritySecret)();
    if (!integritySecret) {
        await releaseLock();
        throw new Error("wompi_integrity_secret_not_configured");
    }
    const publicKey = await (0, runtimeConfig_1.getWompiPublicKey)();
    if (!publicKey) {
        await releaseLock();
        throw new Error("wompi_public_key_not_configured");
    }
    const apiBaseUrl = await (0, runtimeConfig_1.getWompiApiBaseUrl)();
    const checkoutLinkBaseUrl = await (0, runtimeConfig_1.getWompiCheckoutLinkBaseUrl)();
    const wompi = new client_2.WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
    let merchant;
    try {
        merchant = await wompi.getMerchant(publicKey);
    }
    catch (err) {
        await releaseLock();
        throw err;
    }
    const signFor = (ref) => (0, wompiSignature_1.buildWompiTransactionSignature)({
        reference: ref,
        amountInCents,
        currency,
        integritySecret
    });
    let usedReference = reference;
    let created;
    try {
        const existingAfterLock = await prisma_1.prisma.payment.findUnique({
            where: { id: payment.id },
            select: { wompiTransactionId: true, status: true }
        });
        if (existingAfterLock?.wompiTransactionId && existingAfterLock.status === client_1.PaymentStatus.PENDING) {
            await releaseLock();
            return { paymentId: payment.id, wompiTransactionId: existingAfterLock.wompiTransactionId };
        }
        if (existingAfterLock?.status === client_1.PaymentStatus.APPROVED) {
            await releaseLock();
            throw new Error("payment_already_approved");
        }
        const signed = signFor(usedReference);
        usedReference = signed.normalizedReference;
        created = await wompi.createTransaction({
            amount_in_cents: signed.normalizedAmountInCents,
            currency: signed.normalizedCurrency,
            customer_email: sub.customer.email,
            reference: usedReference,
            signature: signed.signature,
            acceptance_token: merchant.acceptanceToken,
            accept_personal_auth: merchant.acceptPersonalAuth,
            payment_source_id: paymentSourceId,
            recurrent: true,
            payment_method: { installments: 1 }
        });
    }
    catch (err) {
        const errMsg = getErrorMessage(err);
        const duplicateReference = /reference/i.test(errMsg) &&
            /(ya ha sido usada|already used|already been used)/i.test(errMsg);
        if (duplicateReference) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "subscriptions.auto_debit", "Reference duplicada en Wompi; bloqueo preventivo para evitar cobro duplicado", {
                subscriptionId: sub.id,
                paymentId: payment.id,
                previousReference: reference,
                nextReference: null
            }).catch((err) => {
                logIgnored(err, "auto debit: failed to write duplicate-reference log", { subscriptionId: sub.id, paymentId: payment.id });
            });
            // Guard-rail anti-duplicado:
            // si Wompi indica referencia usada, no intentamos crear un nuevo cargo con otra referencia.
            // El runner de conciliación se encarga de recuperar el estado real por referencia/transacción.
            throw new Error("wompi_reference_already_used_guard");
        }
        else {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "subscriptions.auto_debit", "Transaction create failed (signature details)", {
                subscriptionId: sub.id,
                paymentId: payment.id,
                reference: usedReference,
                amountInCents,
                currency,
                signature: signFor(usedReference).signature,
                err: errMsg
            }).catch((logErr) => {
                logIgnored(logErr, "auto debit: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
            });
            await prisma_1.prisma.paymentAttempt.create({
                data: {
                    paymentId: payment.id,
                    attemptNo: 0,
                    reference: usedReference,
                    status: "TRANSACTION_CREATE_FAILED",
                    provider: "wompi",
                    errorMessage: getErrorMessage(err)
                }
            });
            await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "subscriptions.auto_debit", "Transaction create failed", {
                subscriptionId: sub.id,
                paymentId: payment.id,
                err: errMsg
            }).catch((logErr) => {
                logIgnored(logErr, "auto debit: failed to write error system log", { subscriptionId: sub.id, paymentId: payment.id });
            });
            throw err;
        }
    }
    finally {
        await releaseLock();
    }
    await prisma_1.prisma.paymentAttempt.create({
        data: {
            paymentId: payment.id,
            attemptNo: 0,
            reference: usedReference,
            status: "TRANSACTION_CREATED",
            provider: "wompi",
            response: created.raw
        }
    });
    const updated = await prisma_1.prisma.payment.update({
        where: { id: payment.id },
        data: { reference: usedReference, wompiTransactionId: created.id, providerResponse: created.raw }
    });
    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "subscriptions.auto_debit", "Transaction created", {
        subscriptionId: sub.id,
        paymentId: updated.id,
        wompiTransactionId: created.id
    }).catch((err) => {
        logIgnored(err, "auto debit: failed to write system log", { subscriptionId: sub.id, paymentId: updated.id });
    });
    return { paymentId: updated.id, wompiTransactionId: created.id };
}
