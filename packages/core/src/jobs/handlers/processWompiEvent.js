"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAssociationByScore = resolveAssociationByScore;
exports.processWompiEventLogic = processWompiEventLogic;
exports.processWompiEvent = processWompiEvent;
exports.forwardWompiToShopify = forwardWompiToShopify;
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../lib/logger");
const systemLog_1 = require("../../services/systemLog");
const client_1 = require("@prisma/client");
const classifyReference_1 = require("../../webhooks/wompi/classifyReference");
const http_1 = require("../../lib/http");
const client_2 = require("@prisma/client");
const runtimeConfig_1 = require("../../services/runtimeConfig");
const notificationsScheduler_1 = require("../../services/notificationsScheduler");
const notificationDelivery_1 = require("../../services/notificationDelivery");
const superAdminApp_1 = require("../../services/superAdminApp");
const chatwootSync_1 = require("../../services/chatwootSync");
const tenantContext_1 = require("../../services/tenantContext");
const gamification_1 = require("../../services/gamification");
const gamificationConfig_1 = require("../../services/gamificationConfig");
const subscriptionMode_1 = require("../../services/subscriptionMode");
const realtimePublisher_1 = require("../../services/realtimePublisher");
const retryJobScheduler_1 = require("../../services/retryJobScheduler");
const billingCycles_1 = require("../../services/billingCycles");
const metadataSchemas_1 = require("../../lib/metadataSchemas");
function getTransactionFromPayload(payload) {
    const tx = payload?.data?.transaction;
    return tx && typeof tx === "object" ? tx : null;
}
function firstText(...values) {
    for (const v of values) {
        const txt = String(v || "").trim();
        if (txt)
            return txt;
    }
    return "";
}
function extractFailureMessage(payload) {
    const tx = getTransactionFromPayload(payload);
    const statusMessage = firstText(tx?.status_message, tx?.statusMessage, tx?.status_reason, tx?.statusReason);
    if (statusMessage)
        return statusMessage;
    const extra = tx?.payment_method?.extra ?? null;
    const extraMsg = firstText(extra?.status_message, extra?.statusMessage, extra?.message, extra?.error);
    return extraMsg;
}
function normalizeReference(value) {
    if (typeof value !== "string")
        return undefined;
    const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
    return cleaned || undefined;
}
function isInternalReference(value) {
    const ref = String(value || "").trim().toUpperCase();
    if (!ref)
        return false;
    return ref.startsWith("SUB_") || ref.startsWith("ORDER_") || ref.startsWith("WOMPI_") || ref.startsWith("TEST_");
}
function isOrderContactReference(value) {
    const ref = String(value || "").trim().toUpperCase();
    return /^ORDER_CONTACT_[A-Z0-9]+_/i.test(ref);
}
function extractPaymentLinkId(raw) {
    if (!raw)
        return undefined;
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed)
            return undefined;
        if (/^https?:\/\//i.test(trimmed)) {
            const parts = trimmed.split("/").filter(Boolean);
            return parts[parts.length - 1] || undefined;
        }
        return trimmed;
    }
    if (typeof raw === "object") {
        const obj = raw;
        const direct = normalizeReference(obj.id);
        if (direct)
            return direct;
        const permalink = extractPaymentLinkId(obj.permalink);
        if (permalink)
            return permalink;
        const checkout = extractPaymentLinkId(obj.checkout_url ?? obj.checkoutUrl);
        if (checkout)
            return checkout;
    }
    return undefined;
}
function getPaymentLinkIdFromPayload(payload) {
    const tx = getTransactionFromPayload(payload);
    return (normalizeReference(tx?.payment_link_id) ??
        normalizeReference(tx?.paymentLinkId) ??
        extractPaymentLinkId(tx?.payment_link) ??
        extractPaymentLinkId(tx?.paymentLink) ??
        extractPaymentLinkId(payload?.data?.payment_link) ??
        extractPaymentLinkId(payload?.data?.paymentLink));
}
async function warnOnceWithDedupe(args) {
    const windowMinutes = Math.max(1, Number(args.windowMinutes || 360));
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const existing = await prisma_1.prisma.systemLog.findFirst({
        where: {
            level: client_1.LogLevel.WARN,
            source: args.source,
            message: args.message,
            createdAt: { gte: since },
            context: { path: ["dedupeKey"], equals: args.dedupeKey }
        },
        select: { id: true }
    });
    if (existing)
        return false;
    await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, args.source, args.message, {
        ...(args.context || {}),
        dedupeKey: args.dedupeKey
    }, "webhook:wompi");
    return true;
}
function getCustomerEmailFromPayload(payload) {
    const tx = getTransactionFromPayload(payload);
    const email = tx?.customer_email ||
        tx?.customerEmail ||
        payload?.data?.customer_email ||
        payload?.data?.customerEmail ||
        tx?.customer_data?.email;
    const trimmed = String(email || "").trim().toLowerCase();
    return trimmed || undefined;
}
function getCustomerNameFromPayload(payload) {
    const tx = getTransactionFromPayload(payload);
    const name = tx?.customer_data?.full_name || tx?.customer_data?.name || tx?.customer_data?.fullName || tx?.customer?.name;
    const trimmed = String(name || "").trim();
    return trimmed || undefined;
}
function getCustomerPhoneFromPayload(payload) {
    const tx = getTransactionFromPayload(payload);
    const phone = tx?.customer_data?.phone_number || tx?.customer_data?.phoneNumber || tx?.customer?.phone_number || tx?.customer?.phone;
    const trimmed = String(phone || "").trim();
    return trimmed || undefined;
}
function normalizePhoneDigits(value) {
    const digits = String(value || "").replace(/\D+/g, "");
    if (!digits)
        return "";
    if (digits.startsWith("57") && digits.length > 10)
        return digits.slice(-10);
    return digits;
}
function phonesMatch(a, b) {
    const da = normalizePhoneDigits(a);
    const db = normalizePhoneDigits(b);
    if (!da || !db)
        return false;
    if (da === db)
        return true;
    return da.length >= 8 && db.length >= 8 && (da.endsWith(db) || db.endsWith(da));
}
function normalizeNameForMatch(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
function readSubscriptionPricingTotalInCents(subscriptionMeta, fallback) {
    return (0, metadataSchemas_1.getExpectedSubscriptionTotalInCents)({
        subscriptionMetadata: subscriptionMeta,
        fallback
    });
}
async function resolveAssociationByScore(args) {
    const directSubscriptionId = args.paymentMatched?.subscriptionId ||
        args.paymentLinkRecord?.subscriptionId ||
        (args.referenceClassification.kind === "subscription" ? args.referenceClassification.subscriptionId : "");
    if (directSubscriptionId) {
        if (args.referenceClassification.kind === "subscription" && args.referenceClassification.subscriptionId) {
            const exists = await args.db.subscription.findUnique({
                where: { id: args.referenceClassification.subscriptionId },
                select: { id: true, customerId: true }
            });
            if (!exists)
                return null;
            return {
                subscriptionId: exists.id,
                customerId: exists.customerId ?? undefined,
                score: 100,
                reason: (args.matchReason || "SUB_REF"),
                criteria: {
                    method: args.matchReason || "SUB_REF",
                    referenceKind: args.referenceClassification.kind
                },
                cycleNumber: args.referenceClassification.cycle ?? args.paymentMatched?.cycleNumber ?? null
            };
        }
        return {
            subscriptionId: directSubscriptionId,
            customerId: args.paymentMatched?.customerId ?? undefined,
            score: 100,
            reason: (args.matchReason || "UNKNOWN"),
            criteria: {
                method: args.matchReason || "UNKNOWN"
            },
            cycleNumber: args.paymentMatched?.cycleNumber ?? null
        };
    }
    const incomingAmount = Number(args.amountInCents || 0);
    if (!incomingAmount)
        return null;
    const incomingCurrency = String(args.currency || "").trim().toUpperCase();
    const tenantScope = args.tenantId ? { tenantId: args.tenantId } : {};
    const customerIds = new Set();
    let identitySource = null;
    if (args.email) {
        const byEmail = await args.db.customer.findMany({
            where: { email: args.email, ...tenantScope },
            select: { id: true }
        });
        if (byEmail.length)
            identitySource = "email";
        byEmail.forEach((c) => customerIds.add(c.id));
    }
    if (args.phone) {
        const byPhone = await args.db.customer.findMany({
            where: { phone: { not: null }, ...tenantScope },
            select: { id: true, phone: true },
            orderBy: { updatedAt: "desc" },
            take: 500
        });
        const matched = byPhone.filter((c) => phonesMatch(c.phone, args.phone));
        if (matched.length)
            identitySource = identitySource ? "email_phone" : "phone";
        matched.forEach((c) => customerIds.add(c.id));
    }
    // Siempre intentamos también por nombre y UNIMOS candidatos (no solo cuando
    // email/teléfono no encontraron nada). Si el email del pago apunta a un Customer
    // DUPLICADO creado por el webhook (mismo cliente, otra fila, sin la suscripción),
    // el match por nombre recupera al cliente real que sí tiene la suscripción.
    // La asociación sigue exigiendo monto EXACTO (o Tier-2 de única sub activa), así
    // que ampliar candidatos no relaja la seguridad. Ver memoria webhook-duplica-clientes.
    {
        const nameNorm = normalizeNameForMatch(args.name);
        if (nameNorm.length >= 4) {
            // No usamos `contains` en SQL: es sensible a tildes y la BD guarda nombres
            // con acentos distintos (mojibake SQL_ASCII), así que "Tomas" no encontraría
            // "Tomás". Traemos un lote acotado del tenant y filtramos por nombre
            // normalizado (sin tildes) en JS. Mismo enfoque que el match por teléfono.
            const byName = await args.db.customer.findMany({
                where: { ...tenantScope },
                select: { id: true, name: true },
                orderBy: { updatedAt: "desc" },
                take: 500
            });
            const matched = byName.filter((c) => normalizeNameForMatch(c.name) === nameNorm);
            if (matched.length && !identitySource)
                identitySource = "name";
            matched.forEach((c) => customerIds.add(c.id));
        }
    }
    if (!customerIds.size || !identitySource)
        return null;
    const candidates = await args.db.subscription.findMany({
        where: {
            customerId: { in: Array.from(customerIds) },
            ...(args.tenantId ? { tenantId: args.tenantId } : {})
        },
        include: {
            plan: {
                select: { priceInCents: true, currency: true, metadata: true, intervalUnit: true, intervalCount: true }
            }
        },
        orderBy: [{ updatedAt: "desc" }]
    });
    const candidatesWithAmounts = candidates
        .filter((s) => {
        const planCurrency = String(s?.plan?.currency || "").trim().toUpperCase();
        return !(incomingCurrency && planCurrency && incomingCurrency !== planCurrency);
    })
        .map((s) => ({
        sub: s,
        expectedTotal: (0, metadataSchemas_1.getExpectedSubscriptionTotalInCents)({
            subscriptionMetadata: s?.metadata,
            planMetadata: s?.plan?.metadata,
            fallback: s?.plan?.priceInCents || 0
        }),
        planCurrency: String(s?.plan?.currency || "").trim().toUpperCase()
    }));
    const withExactAmount = candidatesWithAmounts.filter(({ expectedTotal }) => expectedTotal === incomingAmount).map(({ sub }) => sub);
    if (!withExactAmount.length) {
        // Tier 2: single active subscription fallback for shipping/fee discrepancies
        const activeOnly = candidatesWithAmounts.filter(({ sub }) => sub.status === "ACTIVE" || sub.status === "PAST_DUE");
        if (activeOnly.length === 1) {
            const { sub, expectedTotal } = activeOnly[0];
            logger_1.logger.warn({ tenantId: args.tenantId || null, subscriptionId: sub.id, customerId: sub.customerId, incomingAmount, expectedAmount: expectedTotal, currency: incomingCurrency || null, source: identitySource }, "processWompiEvent/resolveAssociation: asociando por identidad con diferencia de monto (posible flete)");
            return {
                subscriptionId: sub.id,
                customerId: sub.customerId ?? undefined,
                score: identitySource === "name" ? 55 : 65,
                reason: "IDENTITY_MATCH",
                criteria: { method: "identity_amount_mismatch", source: identitySource, incomingAmount, expectedAmount: expectedTotal, currency: incomingCurrency || null }
            };
        }
        if (activeOnly.length > 1) {
            logger_1.logger.warn({ tenantId: args.tenantId || null, customerIds: Array.from(customerIds), subscriptionIds: activeOnly.map(({ sub }) => sub.id), amountInCents: incomingAmount, source: identitySource }, "processWompiEvent/resolveAssociation: multiples suscripciones activas sin coincidencia exacta de monto; se omite autoasignacion");
        }
        return null;
    }
    const score = identitySource === "name" ? 70 : 80;
    if (withExactAmount.length === 1) {
        const winner = withExactAmount[0];
        return {
            subscriptionId: winner.id,
            customerId: winner.customerId ?? undefined,
            score,
            reason: "IDENTITY_MATCH",
            criteria: {
                method: "identity",
                source: identitySource,
                amountInCents: incomingAmount,
                currency: incomingCurrency || null
            }
        };
    }
    if (args.db === prisma_1.prisma) {
        await (0, billingCycles_1.ensureBillingCyclesForSubscriptions)(withExactAmount.map((sub) => (0, billingCycles_1.buildBillingSeed)({
            id: sub.id,
            startAt: sub.startAt,
            cycleStartDay: sub.cycleStartDay,
            paymentDay: sub.paymentDay,
            paymentTiming: sub.paymentTiming,
            graceDays: sub.graceDays,
            plan: {
                intervalUnit: sub.plan?.intervalUnit,
                intervalCount: sub.plan?.intervalCount
            }
        }))).catch((err) => {
            logger_1.logger.warn({ err, subscriptionIds: withExactAmount.map((sub) => sub.id) }, "processWompiEvent: fallo asegurando ciclos para desempate por identidad");
        });
    }
    const oldestCycles = await args.db.subscriptionBillingCycle.findMany({
        where: {
            subscriptionId: { in: withExactAmount.map((sub) => sub.id) },
            paymentId: null,
            status: { not: client_1.BillingCycleStatus.PAID }
        },
        orderBy: [{ dueAt: "asc" }, { periodStartAt: "asc" }, { cycleNumber: "asc" }],
        take: 1
    });
    const oldest = oldestCycles[0];
    if (!oldest)
        return null;
    const winner = withExactAmount.find((sub) => sub.id === oldest.subscriptionId);
    if (!winner)
        return null;
    return {
        subscriptionId: winner.id,
        customerId: winner.customerId ?? undefined,
        score,
        reason: "IDENTITY_MATCH",
        criteria: {
            method: "identity",
            source: identitySource,
            amountInCents: incomingAmount,
            currency: incomingCurrency || null,
            tieBreak: "oldest_unpaid_cycle"
        },
        cycleNumber: oldest.cycleNumber
    };
}
async function findOldestUnpaidCycle(args) {
    if (args.db === prisma_1.prisma) {
        await (0, billingCycles_1.ensureBillingCyclesForSubscriptions)([
            (0, billingCycles_1.buildBillingSeed)({
                id: args.subscription.id,
                startAt: args.subscription.startAt,
                cycleStartDay: args.subscription.cycleStartDay,
                paymentDay: args.subscription.paymentDay,
                paymentTiming: args.subscription.paymentTiming,
                graceDays: args.subscription.graceDays,
                plan: {
                    intervalUnit: args.subscription.plan.intervalUnit,
                    intervalCount: args.subscription.plan.intervalCount
                }
            })
        ]).catch((err) => {
            logger_1.logger.warn({ err, subscriptionId: args.subscription.id }, "processWompiEvent: fallo asegurando ciclos para oldest unpaid");
        });
    }
    const cycles = await args.db.subscriptionBillingCycle.findMany({
        where: {
            subscriptionId: args.subscription.id,
            paymentId: null,
            status: { not: client_1.BillingCycleStatus.PAID }
        },
        orderBy: [{ cycleNumber: "asc" }]
    });
    return cycles[0] ?? null;
}
function getPaidAtFromPayload(payload) {
    const tx = getTransactionFromPayload(payload);
    const raw = tx?.paid_at ||
        tx?.paidAt ||
        tx?.finalized_at ||
        tx?.finalizedAt ||
        tx?.created_at ||
        tx?.createdAt ||
        payload?.timestamp;
    if (!raw)
        return null;
    const rawNum = Number(raw);
    const normalizedRaw = Number.isFinite(rawNum) && rawNum > 0
        ? (rawNum < 1_000_000_000_000 ? rawNum * 1000 : rawNum)
        : raw;
    const dt = new Date(normalizedRaw);
    return Number.isNaN(dt.getTime()) ? null : dt;
}
function getProviderEventAt(providerTs) {
    if (providerTs == null)
        return null;
    const num = Number(providerTs);
    if (!Number.isFinite(num) || num <= 0)
        return null;
    const ms = num < 1_000_000_000_000 ? num * 1000 : num;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? null : dt;
}
function getPaymentSourceFromProviderResponse(resp) {
    if (!resp || typeof resp !== "object")
        return "";
    const order = resp.order;
    if (!order || typeof order !== "object")
        return "";
    return String(order.source || "").toUpperCase();
}
function resolvePersistedPaymentStatus(prev, incoming) {
    if (!incoming)
        return prev;
    if (!prev)
        return incoming;
    if (prev === client_2.PaymentStatus.APPROVED)
        return client_2.PaymentStatus.APPROVED;
    if (incoming === client_2.PaymentStatus.APPROVED)
        return client_2.PaymentStatus.APPROVED;
    if ((prev === client_2.PaymentStatus.DECLINED || prev === client_2.PaymentStatus.ERROR || prev === client_2.PaymentStatus.VOIDED) &&
        incoming === client_2.PaymentStatus.PENDING) {
        return prev;
    }
    return incoming;
}
async function processWompiEventLogic(webhookEventId, db) {
    // Lock to prevent race conditions between inline processing and background worker.
    const lockKey = `webhook-process:${webhookEventId}`;
    const lockAcquired = await db.$queryRaw `
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) as locked
  `.then(rows => Boolean(rows?.[0]?.locked)).catch((err) => {
        logger_1.logger.warn({ err, webhookEventId }, "processWompiEvent: fallo adquiriendo advisory lock");
        return false;
    });
    if (!lockAcquired) {
        logger_1.logger.info({ webhookEventId }, "Webhook processing already in progress (lock skip)");
        return;
    }
    try {
        const event = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
        if (!event)
            return;
        if (event.processStatus === client_2.WebhookProcessStatus.PROCESSED)
            return;
        const payload = (event.payload && typeof event.payload === "object" ? event.payload : {});
        const paymentsCfg = await (0, runtimeConfig_1.getPaymentsConfig)().catch(() => ({
            autoReconcileUnlinkedPayments: true,
            acceptUnlinkedPayments: true,
            notifyWhatsappForUnlinkedPayments: true,
            includeUnlinkedPaymentsInMetrics: true
        }));
        const tx = getTransactionFromPayload(payload);
        const reference = normalizeReference(tx?.reference);
        const transactionId = normalizeReference(tx?.id);
        const paymentLinkId = getPaymentLinkIdFromPayload(payload);
        const status = tx?.status;
        const amountInCents = tx?.amount_in_cents ?? tx?.amountInCents;
        const currency = tx?.currency;
        const checkoutUrlFromLink = paymentLinkId
            ? (() => {
                const rawBase = (0, runtimeConfig_1.getWompiCheckoutLinkBaseUrl)();
                return rawBase.then((base) => {
                    const normalized = base.endsWith("/") ? base : `${base}/`;
                    return `${normalized}${paymentLinkId}`;
                });
            })()
            : Promise.resolve(undefined);
        // Prefer mapping by payment_link_id (subscriptions created via API payment links)
        let paymentByLink = paymentLinkId
            ? await db.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } })
            : null;
        const paymentLinkRecord = paymentLinkId
            ? await db.paymentLink.findUnique({
                where: { wompiPaymentLinkId: paymentLinkId },
                select: { paymentId: true, subscriptionId: true }
            })
            : null;
        if (!paymentByLink && paymentLinkRecord?.paymentId) {
            paymentByLink = await db.payment.findUnique({ where: { id: paymentLinkRecord.paymentId } });
        }
        const paymentByTxId = transactionId
            ? await db.payment.findUnique({ where: { wompiTransactionId: transactionId } })
            : null;
        let paymentByReference = reference
            ? await db.payment.findFirst({
                where: {
                    reference,
                    ...(event.tenantId ? { tenantId: event.tenantId } : {})
                },
                orderBy: { createdAt: "desc" }
            })
            : null;
        if (!paymentByReference && reference && event.tenantId) {
            paymentByReference = await db.payment.findFirst({
                where: { reference },
                orderBy: { createdAt: "desc" }
            });
        }
        // Último recurso: la referencia de un intento anterior. El pago reescribe su
        // referencia en cada reintento (_R57, _R58...), así que un webhook que llega
        // tarde trae una que ya no existe en la tabla de pagos y, sin esto, termina
        // creando un pago huérfano sin suscripción.
        if (!paymentByReference && reference) {
            const intento = await db.paymentAttempt.findFirst({
                where: { reference },
                orderBy: { createdAt: "desc" },
                select: { paymentId: true }
            });
            if (intento?.paymentId) {
                paymentByReference = await db.payment.findUnique({ where: { id: intento.paymentId } });
            }
        }
        const paymentMatched = paymentByLink ?? paymentByTxId ?? paymentByReference ?? null;
        const referenceClassification = (0, classifyReference_1.classifyReference)(reference);
        const matchReason = paymentByLink || paymentLinkRecord?.paymentId
            ? "LINK_MATCH"
            : paymentByTxId
                ? "TX_MATCH"
                : paymentByReference
                    ? "REF_MATCH"
                    : referenceClassification.kind === "subscription" && referenceClassification.subscriptionId
                        ? "SUB_REF"
                        : null;
        const paymentSource = getPaymentSourceFromProviderResponse(paymentMatched?.providerResponse);
        const isShopifyPayment = referenceClassification.kind === "shopify" ||
            paymentSource === "SHOPIFY";
        // Shopify payments are forwarded but not processed as subscriptions.
        if (isShopifyPayment) {
            await db.webhookEvent.update({
                where: { id: webhookEventId },
                data: { processStatus: client_2.WebhookProcessStatus.SKIPPED, processedAt: new Date() }
            });
            return;
        }
        let inferredSubscriptionId = paymentMatched?.subscriptionId ??
            paymentLinkRecord?.subscriptionId ??
            (referenceClassification.kind === "subscription" ? referenceClassification.subscriptionId : "");
        let inferredSubscription = null;
        const email = getCustomerEmailFromPayload(payload);
        const phone = getCustomerPhoneFromPayload(payload);
        const name = getCustomerNameFromPayload(payload);
        let associationScore = null;
        let associationCriteria = null;
        let associationReasonFromScore = null;
        let associationCycleNumber = null;
        let associationCycleId = null;
        const missingPaymentLinkRecord = Boolean(paymentLinkId && !paymentByLink && !paymentLinkRecord);
        const likelyExternalRefOnly = !paymentMatched && !paymentLinkRecord && referenceClassification.kind === "unknown" && !isInternalReference(reference);
        if (missingPaymentLinkRecord && !likelyExternalRefOnly) {
            await warnOnceWithDedupe({
                source: "processWompiEvent",
                message: "payment_link_not_found: proceeding by inference",
                dedupeKey: `${String(paymentLinkId || "sin_link")}|${String(reference || "sin_ref")}`,
                context: { paymentLinkId, reference },
                windowMinutes: 360
            }).catch((err) => {
                logger_1.logger.warn({ err, paymentLinkId, reference }, "processWompiEvent: fallo registrando advertencia deduplicada");
            });
        }
        // FIX: Si la referencia viene de un cobro manual (SUB_xxx_cycle), usar ese subscriptionId directamente
        // La inferencia por identidad solo debe usarse cuando NO hay referencia estructurada
        if (referenceClassification.kind === "subscription" && referenceClassification.subscriptionId && !paymentMatched) {
            const exists = await db.subscription.findUnique({
                where: { id: referenceClassification.subscriptionId },
                select: { id: true }
            });
            if (exists) {
                inferredSubscriptionId = referenceClassification.subscriptionId;
            }
        }
        // FIX: Si la referencia es SUB_xxx_cycle y no hay payment matched, usar el subscriptionId de la referencia
        // La inferencia por identidad SOLO debe usarse para referencias desconocidas
        const hasStructuredReference = referenceClassification.kind === "subscription" && referenceClassification.subscriptionId;
        const canTryIdentity = paymentsCfg.autoReconcileUnlinkedPayments && !inferredSubscriptionId && !hasStructuredReference;
        const shouldResolveScore = Boolean(matchReason || hasStructuredReference || canTryIdentity);
        if (shouldResolveScore) {
            const decision = await resolveAssociationByScore({
                db,
                tenantId: event.tenantId,
                amountInCents,
                currency,
                matchReason: matchReason,
                paymentMatched,
                paymentLinkRecord,
                referenceClassification,
                email,
                phone,
                name
            });
            if (decision?.subscriptionId) {
                inferredSubscriptionId = decision.subscriptionId;
                associationScore = decision.score;
                associationCriteria = decision.criteria;
                associationReasonFromScore = decision.reason;
                associationCycleNumber = decision.cycleNumber ?? null;
                if (decision.reason === "IDENTITY_MATCH") {
                    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "processWompiEvent", "subscription_inferred_by_scoring", {
                        reference,
                        subscriptionId: decision.subscriptionId,
                        score: decision.score,
                        criteria: decision.criteria
                    }, "webhook:wompi").catch((err) => {
                        logger_1.logger.warn({ err, reference, subscriptionId: decision.subscriptionId }, "processWompiEvent: fallo escribiendo systemLog de inferencia por scoring");
                    });
                }
            }
            else if (canTryIdentity) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "processWompiEvent", "identity_match_failed: pago no asociado automaticamente", {
                    reference,
                    amountInCents,
                    currency,
                    email: email || null,
                    phone: phone || null,
                    hasName: !!name,
                    reason: !email && !phone
                        ? "sin_email_ni_telefono"
                        : !amountInCents
                            ? "sin_monto"
                            : "multiples_suscripciones_activas_o_sin_coincidencia"
                }, "webhook:wompi").catch((err) => {
                    logger_1.logger.warn({ err, reference }, "processWompiEvent: fallo escribiendo systemLog de identidad fallida");
                });
            }
            else if (hasStructuredReference) {
                await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "processWompiEvent", "Payment no encontrado, se usará referencia estructurada", {
                    reference,
                    subscriptionIdFromRef: referenceClassification.subscriptionId,
                    kind: referenceClassification.kind
                }, "webhook:wompi").catch((err) => {
                    logger_1.logger.warn({ err, reference }, "processWompiEvent: fallo escribiendo systemLog de referencia estructurada");
                });
            }
        }
        const subscriptionId = inferredSubscriptionId;
        const isSubscription = !!subscriptionId;
        // Registrar pago y, si está aprobado, renovar ciclo (solo para suscripciones).
        const subscription = inferredSubscription ??
            (isSubscription
                ? await db.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } })
                : null);
        if (isSubscription && !subscription) {
            await db.webhookEvent.update({
                where: { id: webhookEventId },
                data: { processStatus: client_2.WebhookProcessStatus.FAILED, errorMessage: "subscription not found", processedAt: new Date() }
            });
            return;
        }
        if (subscription && associationReasonFromScore === "IDENTITY_MATCH" && !associationCycleNumber) {
            const oldest = await findOldestUnpaidCycle({ db, subscription });
            if (oldest) {
                associationCycleId = oldest.id;
                associationCycleNumber = oldest.cycleNumber;
            }
        }
        if (subscription && associationCycleNumber != null && !associationCycleId) {
            if (db === prisma_1.prisma) {
                await (0, billingCycles_1.ensureBillingCyclesForSubscriptions)([
                    (0, billingCycles_1.buildBillingSeed)({
                        id: subscription.id,
                        startAt: subscription.startAt,
                        cycleStartDay: subscription.cycleStartDay,
                        paymentDay: subscription.paymentDay,
                        paymentTiming: subscription.paymentTiming,
                        graceDays: subscription.graceDays,
                        plan: {
                            intervalUnit: subscription.plan.intervalUnit,
                            intervalCount: subscription.plan.intervalCount
                        }
                    })
                ]).catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: subscription.id, cycleNumber: associationCycleNumber }, "processWompiEvent: fallo asegurando ciclos para cycleNumber");
                });
            }
            const cycleByNumber = await db.subscriptionBillingCycle.findUnique({
                where: { subscriptionId_cycleNumber: { subscriptionId: subscription.id, cycleNumber: associationCycleNumber } }
            });
            if (cycleByNumber)
                associationCycleId = cycleByNumber.id;
        }
        const normalizedStatus = String(status || "").toUpperCase();
        const paymentStatus = normalizedStatus === "APPROVED"
            ? client_2.PaymentStatus.APPROVED
            : normalizedStatus === "DECLINED"
                ? client_2.PaymentStatus.DECLINED
                : normalizedStatus === "ERROR"
                    ? client_2.PaymentStatus.ERROR
                    : normalizedStatus === "VOIDED"
                        ? client_2.PaymentStatus.VOIDED
                        : normalizedStatus === "PENDING" || normalizedStatus === "PROCESSING"
                            ? client_2.PaymentStatus.PENDING
                            : null;
        const prevByTx = transactionId != null ? await db.payment.findUnique({ where: { wompiTransactionId: transactionId } }) : null;
        const prevStatus = prevByTx?.status ?? paymentMatched?.status ?? null;
        const nextStatus = resolvePersistedPaymentStatus(prevStatus, paymentStatus);
        const wasApproved = prevStatus === client_2.PaymentStatus.APPROVED;
        const wasFailed = prevStatus === client_2.PaymentStatus.DECLINED || prevStatus === client_2.PaymentStatus.ERROR || prevStatus === client_2.PaymentStatus.VOIDED;
        const now = new Date();
        const paidAtFromPayload = getPaidAtFromPayload(payload);
        const providerEventAt = getProviderEventAt(event.providerTs);
        const paidAt = nextStatus === client_2.PaymentStatus.APPROVED
            ? (paidAtFromPayload ?? providerEventAt ?? event.receivedAt ?? now)
            : null;
        const computedFailedAt = nextStatus && nextStatus !== client_2.PaymentStatus.APPROVED && nextStatus !== client_2.PaymentStatus.PENDING ? now : null;
        const associationAt = paidAt ?? paidAtFromPayload ?? providerEventAt ?? event.receivedAt ?? now;
        const cycleFromRef = referenceClassification.kind === "subscription" ? referenceClassification.cycle ?? null : null;
        let cycle = cycleFromRef ?? associationCycleNumber ?? null;
        if (subscription && cycle == null) {
            if (db === prisma_1.prisma) {
                await (0, billingCycles_1.ensureBillingCyclesForSubscriptions)([
                    (0, billingCycles_1.buildBillingSeed)({
                        id: subscription.id,
                        startAt: subscription.startAt,
                        cycleStartDay: subscription.cycleStartDay,
                        paymentDay: subscription.paymentDay,
                        paymentTiming: subscription.paymentTiming,
                        graceDays: subscription.graceDays,
                        plan: {
                            intervalUnit: subscription.plan.intervalUnit,
                            intervalCount: subscription.plan.intervalCount
                        }
                    })
                ]).catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: subscription.id }, "processWompiEvent: fallo asegurando ciclos para inferir ciclo del pago");
                });
            }
            const candidateCycles = await db.subscriptionBillingCycle.findMany({
                where: {
                    subscriptionId: subscription.id,
                    paymentId: null,
                    status: { not: client_1.BillingCycleStatus.PAID }
                },
                orderBy: [{ dueAt: "asc" }, { cycleNumber: "asc" }]
            }).catch((err) => {
                logger_1.logger.warn({ err, subscriptionId: subscription.id }, "processWompiEvent: fallo leyendo ciclos candidatos para inferir ciclo del pago");
                return [];
            });
            const inferredMatch = (0, billingCycles_1.findBestBillingCycleForPayment)({
                cycles: candidateCycles,
                paymentAt: associationAt,
                toleranceDays: 7
            });
            if (inferredMatch) {
                cycle = inferredMatch.cycleNumber;
                associationCycleId = associationCycleId || inferredMatch.id;
                associationCycleNumber = associationCycleNumber ?? inferredMatch.cycleNumber;
            }
        }
        const subscriptionCycleKey = subscription && cycle != null ? `${subscription.id}:${cycle}` : null;
        const shouldIgnoreUnlinked = !subscription && !paymentsCfg.acceptUnlinkedPayments;
        const reconciliationForUnlinked = shouldIgnoreUnlinked
            ? { status: "IGNORED_EXTERNAL", reason: "unlinked_payment", at: new Date().toISOString() }
            : null;
        const associationReason = paymentMatched?.associationReason ||
            associationReasonFromScore ||
            matchReason ||
            (shouldIgnoreUnlinked ? "UNLINKED" : null) ||
            "UNKNOWN";
        const origin = paymentMatched?.origin ||
            paymentByLink?.origin ||
            paymentByTxId?.origin ||
            paymentByReference?.origin ||
            "WEBHOOK";
        const matchMetaData = associationScore != null
            ? {
                matchScore: associationScore,
                matchCriteria: associationCriteria
            }
            : {};
        let paymentResolved = paymentMatched;
        if (!paymentResolved && !subscription) {
            const tenantIdFallback = event.tenantId ?? (await (0, tenantContext_1.getDefaultTenantId)());
            if (!tenantIdFallback) {
                await db.webhookEvent.update({
                    where: { id: webhookEventId },
                    data: { processStatus: client_2.WebhookProcessStatus.FAILED, errorMessage: "missing_tenant", processedAt: new Date() }
                });
                return;
            }
            const email = getCustomerEmailFromPayload(payload);
            const phone = getCustomerPhoneFromPayload(payload);
            let customer = null;
            let emailConflictOtherTenant = false;
            const byEmail = email ? await db.customer.findUnique({ where: { email } }) : null;
            if (byEmail) {
                if (!tenantIdFallback || byEmail.tenantId === tenantIdFallback) {
                    customer = byEmail;
                }
                else {
                    const linked = await db.customerTenant.findFirst({
                        where: { customerId: byEmail.id, tenantId: tenantIdFallback },
                        select: { id: true }
                    });
                    if (linked)
                        customer = byEmail;
                    else
                        emailConflictOtherTenant = true;
                }
            }
            if (!customer && phone) {
                const byPhone = await db.customer.findMany({
                    where: {
                        phone: { not: null },
                        ...(tenantIdFallback
                            ? {
                                OR: [{ tenantId: tenantIdFallback }, { tenantLinks: { some: { tenantId: tenantIdFallback } } }]
                            }
                            : {})
                    },
                    select: { id: true, phone: true },
                    take: 300
                });
                const matchedPhone = byPhone.find((c) => phonesMatch(c.phone, phone));
                if (matchedPhone?.id) {
                    customer = await db.customer.findUnique({ where: { id: matchedPhone.id } });
                }
            }
            if (!customer) {
                const name = String(getCustomerNameFromPayload(payload) || "").trim();
                const emailValue = String(email || "").trim();
                const phoneValue = String(phone || "").trim();
                if (!name || !emailValue || !phoneValue) {
                    await db.webhookEvent.update({
                        where: { id: webhookEventId },
                        data: {
                            processStatus: client_2.WebhookProcessStatus.FAILED,
                            errorMessage: "missing_customer_fields",
                            processedAt: new Date()
                        }
                    });
                    await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "wompi.webhook", "No se crea contacto: faltan nombre/email/teléfono", {
                        webhookEventId,
                        tenantId: tenantIdFallback,
                        hasName: Boolean(name),
                        hasEmail: Boolean(emailValue),
                        hasPhone: Boolean(phoneValue)
                    }, "webhook:wompi").catch((err) => {
                        logger_1.logger.warn({ err, webhookEventId }, "wompi.webhook: failed to write system log");
                    });
                    return;
                }
                const fallbackMeta = { source: "wompi_webhook_fallback" };
                if (email)
                    fallbackMeta.incomingEmail = email;
                if (emailConflictOtherTenant)
                    fallbackMeta.emailTenantConflict = true;
                customer = await db.customer.create({
                    data: {
                        tenantId: tenantIdFallback,
                        email: emailConflictOtherTenant ? null : emailValue,
                        name,
                        phone: phoneValue,
                        metadata: fallbackMeta
                    }
                });
            }
            const fallbackReference = reference ?? (transactionId ? `WOMPI_${transactionId}` : `WOMPI_WEBHOOK_${webhookEventId}`);
            const fallbackCurrency = String(currency || "COP").trim().toUpperCase() || "COP";
            const fallbackStatus = nextStatus ?? client_2.PaymentStatus.PENDING;
            // FIX: Si hay referencia estructurada SUB_xxx, intentar asignar la suscripción
            let fallbackSubscriptionId = null;
            let fallbackCustomerId = customer.id;
            if (referenceClassification.kind === "subscription" && referenceClassification.subscriptionId) {
                const subFromRef = await db.subscription.findUnique({
                    where: { id: referenceClassification.subscriptionId },
                    select: { id: true, customerId: true }
                }).catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: referenceClassification.subscriptionId }, "processWompiEvent: fallo resolviendo suscripción desde referencia");
                    return null;
                });
                if (subFromRef) {
                    fallbackSubscriptionId = subFromRef.id;
                    fallbackCustomerId = subFromRef.customerId;
                }
            }
            if (transactionId) {
                paymentResolved = await db.payment.upsert({
                    where: { wompiTransactionId: transactionId },
                    create: {
                        tenantId: tenantIdFallback,
                        customerId: fallbackCustomerId,
                        amountInCents: amountInCents ?? 0,
                        currency: fallbackCurrency,
                        reference: fallbackReference,
                        wompiTransactionId: transactionId,
                        wompiPaymentLinkId: paymentLinkId,
                        status: fallbackStatus,
                        paidAt: fallbackStatus === client_2.PaymentStatus.APPROVED ? paidAt : null,
                        failedAt: fallbackStatus === client_2.PaymentStatus.APPROVED || fallbackStatus === client_2.PaymentStatus.PENDING
                            ? null
                            : computedFailedAt,
                        subscriptionId: fallbackSubscriptionId,
                        origin,
                        associationReason: associationReason,
                        associatedBy: "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) }
                    },
                    update: {
                        tenantId: tenantIdFallback,
                        customerId: fallbackCustomerId,
                        amountInCents: amountInCents ?? undefined,
                        currency: fallbackCurrency,
                        reference: fallbackReference,
                        wompiPaymentLinkId: paymentLinkId ?? undefined,
                        status: fallbackStatus,
                        paidAt: fallbackStatus === client_2.PaymentStatus.APPROVED ? paidAt : undefined,
                        failedAt: fallbackStatus === client_2.PaymentStatus.APPROVED
                            ? null
                            : fallbackStatus === client_2.PaymentStatus.PENDING
                                ? undefined
                                : computedFailedAt,
                        subscriptionId: fallbackSubscriptionId ?? undefined,
                        origin: paymentResolved?.origin ?? origin,
                        associationReason: paymentResolved?.associationReason ?? associationReason,
                        associatedBy: paymentResolved?.associatedBy ?? "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) }
                    }
                });
            }
            else if (paymentLinkId) {
                paymentResolved = await db.payment.upsert({
                    where: { wompiPaymentLinkId: paymentLinkId },
                    create: {
                        tenantId: tenantIdFallback,
                        customerId: fallbackCustomerId,
                        amountInCents: amountInCents ?? 0,
                        currency: fallbackCurrency,
                        reference: fallbackReference,
                        wompiPaymentLinkId: paymentLinkId,
                        status: fallbackStatus,
                        paidAt: fallbackStatus === client_2.PaymentStatus.APPROVED ? paidAt : null,
                        failedAt: fallbackStatus === client_2.PaymentStatus.APPROVED || fallbackStatus === client_2.PaymentStatus.PENDING
                            ? null
                            : computedFailedAt,
                        subscriptionId: fallbackSubscriptionId,
                        origin,
                        associationReason: associationReason,
                        associatedBy: "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) }
                    },
                    update: {
                        tenantId: tenantIdFallback,
                        customerId: fallbackCustomerId,
                        amountInCents: amountInCents ?? undefined,
                        currency: fallbackCurrency,
                        reference: fallbackReference,
                        status: fallbackStatus,
                        paidAt: fallbackStatus === client_2.PaymentStatus.APPROVED ? paidAt : undefined,
                        failedAt: fallbackStatus === client_2.PaymentStatus.APPROVED
                            ? null
                            : fallbackStatus === client_2.PaymentStatus.PENDING
                                ? undefined
                                : computedFailedAt,
                        subscriptionId: fallbackSubscriptionId ?? undefined,
                        origin: paymentResolved?.origin ?? origin,
                        associationReason: paymentResolved?.associationReason ?? associationReason,
                        associatedBy: paymentResolved?.associatedBy ?? "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) }
                    }
                });
            }
            else {
                paymentResolved = await db.payment.create({
                    data: {
                        tenantId: tenantIdFallback,
                        customerId: fallbackCustomerId,
                        amountInCents: amountInCents ?? 0,
                        currency: fallbackCurrency,
                        reference: fallbackReference,
                        status: fallbackStatus,
                        paidAt: fallbackStatus === client_2.PaymentStatus.APPROVED ? paidAt : null,
                        failedAt: fallbackStatus === client_2.PaymentStatus.APPROVED || fallbackStatus === client_2.PaymentStatus.PENDING
                            ? null
                            : computedFailedAt,
                        subscriptionId: fallbackSubscriptionId,
                        origin,
                        associationReason: associationReason,
                        associatedBy: "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) }
                    }
                });
            }
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "webhooks.wompi", "Webhook sin suscripción asociada; pago creado en fallback", {
                webhookEventId,
                paymentId: paymentResolved.id,
                transactionId,
                paymentLinkId,
                reference: fallbackReference,
                customerId: customer.id
            }, "webhook:wompi").catch((err) => {
                logger_1.logger.warn({ err, webhookEventId, paymentId: paymentResolved?.id }, "processWompiEvent: fallo escribiendo systemLog de fallback sin suscripción");
            });
        }
        const tenantIdForPayment = subscription?.tenantId ?? paymentResolved?.tenantId ?? (await (0, tenantContext_1.getDefaultTenantId)());
        if (!tenantIdForPayment) {
            await db.webhookEvent.update({
                where: { id: webhookEventId },
                data: { processStatus: client_2.WebhookProcessStatus.FAILED, errorMessage: "missing_tenant", processedAt: new Date() }
            });
            return;
        }
        const checkoutUrlResolved = await checkoutUrlFromLink;
        const resolvedCheckoutUrl = paymentResolved?.checkoutUrl ||
            prevByTx?.checkoutUrl ||
            checkoutUrlResolved;
        const wompiTransactionUpdate = transactionId ? { wompiTransactionId: transactionId } : {};
        const inferredSubscriptionCycleKey = subscription && cycle != null && Number.isFinite(Number(cycle)) ? `${subscription.id}:${cycle}` : null;
        let canAssignSubscriptionCycleKey = false;
        if (paymentResolved?.id && inferredSubscriptionCycleKey) {
            const sameCycle = await db.payment.findUnique({
                where: { subscriptionCycleKey: inferredSubscriptionCycleKey },
                select: { id: true }
            });
            canAssignSubscriptionCycleKey = !sameCycle || sameCycle.id === paymentResolved.id;
        }
        const paymentRecord = paymentResolved
            ? await db.payment.update({
                where: { id: paymentResolved.id },
                data: {
                    ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
                    ...wompiTransactionUpdate,
                    ...(nextStatus ? { status: nextStatus } : {}),
                    paidAt: nextStatus === client_2.PaymentStatus.APPROVED ? paidAt : paymentResolved.paidAt ?? null,
                    failedAt: nextStatus === client_2.PaymentStatus.APPROVED
                        ? null
                        : nextStatus === client_2.PaymentStatus.PENDING
                            ? paymentResolved.failedAt ?? null
                            : paymentResolved.failedAt ?? computedFailedAt,
                    origin: paymentResolved?.origin ?? origin,
                    associationReason: paymentResolved?.associationReason ?? associationReason,
                    associatedBy: paymentResolved?.associatedBy ?? "system",
                    ...matchMetaData,
                    providerResponse: paymentResolved.providerResponse && typeof paymentResolved.providerResponse === "object"
                        ? {
                            ...paymentResolved.providerResponse,
                            webhook: payload,
                            ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {})
                        }
                        : { webhook: payload, ...(reconciliationForUnlinked ? { reconciliation: reconciliationForUnlinked } : {}) },
                    amountInCents: amountInCents ?? paymentResolved.amountInCents,
                    currency: currency ?? paymentResolved.currency,
                    reference: reference ?? paymentResolved.reference,
                    ...(subscription
                        ? {
                            subscriptionId: subscription.id,
                            customerId: subscription.customerId,
                            cycleNumber: cycle ?? paymentResolved.cycleNumber ?? undefined
                        }
                        : {}),
                    ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
                    subscriptionCycleKey: subscription && inferredSubscriptionCycleKey && canAssignSubscriptionCycleKey
                        ? inferredSubscriptionCycleKey
                        : paymentResolved.subscriptionCycleKey
                }
            })
            : subscriptionCycleKey
                ? await db.payment.upsert({
                    where: { subscriptionCycleKey },
                    create: {
                        tenant: { connect: { id: tenantIdForPayment } },
                        customer: { connect: { id: subscription.customerId } },
                        subscription: { connect: { id: subscription.id } },
                        amountInCents: amountInCents ?? 0,
                        currency: currency ?? "COP",
                        cycleNumber: cycle ?? undefined,
                        reference: reference ?? `SUB_${subscription.id}_${cycle}`,
                        ...wompiTransactionUpdate,
                        wompiPaymentLinkId: paymentLinkId,
                        ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
                        ...(nextStatus ? { status: nextStatus } : {}),
                        paidAt,
                        failedAt: computedFailedAt,
                        origin,
                        associationReason: associationReason,
                        associatedBy: "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload },
                        subscriptionCycleKey
                    },
                    update: {
                        ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
                        ...wompiTransactionUpdate,
                        ...(nextStatus ? { status: nextStatus } : {}),
                        paidAt,
                        failedAt: nextStatus === client_2.PaymentStatus.APPROVED
                            ? null
                            : nextStatus === client_2.PaymentStatus.PENDING
                                ? prevByTx?.failedAt ?? null
                                : prevByTx?.failedAt ?? computedFailedAt,
                        origin: prevByTx?.origin ?? origin,
                        associationReason: prevByTx?.associationReason ?? associationReason,
                        associatedBy: prevByTx?.associatedBy ?? "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload },
                        reference: reference ?? undefined,
                        cycleNumber: cycle ?? undefined,
                        ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
                        wompiPaymentLinkId: paymentLinkId ?? undefined
                    }
                })
                : await db.payment.create({
                    data: {
                        tenant: { connect: { id: tenantIdForPayment } },
                        customer: { connect: { id: subscription.customerId } },
                        subscription: { connect: { id: subscription.id } },
                        amountInCents: amountInCents ?? 0,
                        currency: currency ?? "COP",
                        cycleNumber: cycle ?? undefined,
                        reference: reference ?? `SUB_${subscription.id}`,
                        ...wompiTransactionUpdate,
                        wompiPaymentLinkId: paymentLinkId,
                        ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
                        ...(nextStatus ? { status: nextStatus } : {}),
                        paidAt,
                        failedAt: computedFailedAt,
                        origin,
                        associationReason: associationReason,
                        associatedBy: "system",
                        ...matchMetaData,
                        providerResponse: { webhook: payload }
                    }
                });
        if (paymentRecord.subscriptionId && paymentRecord.paidAt) {
            if (associationCycleId) {
                await (0, billingCycles_1.attachPaymentToCycle)({
                    subscriptionId: paymentRecord.subscriptionId,
                    paymentId: paymentRecord.id,
                    cycleId: associationCycleId,
                    paymentAt: paymentRecord.paidAt,
                    origin: paymentRecord.origin,
                    associationReason: paymentRecord.associationReason,
                    associatedBy: paymentRecord.associatedBy || "system"
                }).catch((err) => {
                    logger_1.logger.warn({ err, paymentId: paymentRecord.id, cycleId: associationCycleId }, "processWompiEvent: fallo adjuntando pago a ciclo específico");
                });
            }
            else {
                await (0, billingCycles_1.attachPaymentToMatchingCycle)({
                    subscriptionId: paymentRecord.subscriptionId,
                    paymentId: paymentRecord.id,
                    paymentAt: paymentRecord.paidAt,
                    origin: paymentRecord.origin,
                    associationReason: paymentRecord.associationReason,
                    associatedBy: paymentRecord.associatedBy || "system",
                    cycleNumberHint: paymentRecord.cycleNumber ?? null
                }).catch((err) => {
                    logger_1.logger.warn({ err, paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId }, "processWompiEvent: fallo adjuntando pago al ciclo coincidente");
                });
            }
        }
        let approvedBillingReconciliation = null;
        if (paymentRecord.subscriptionId && paymentRecord.paidAt) {
            approvedBillingReconciliation = await (0, billingCycles_1.reconcileApprovedPaymentWithSubscription)({
                subscriptionId: paymentRecord.subscriptionId,
                paymentId: paymentRecord.id,
                paymentAt: paymentRecord.paidAt,
                cycleId: associationCycleId,
                cycleNumberHint: paymentRecord.cycleNumber ?? null,
                origin: paymentRecord.origin,
                associationReason: paymentRecord.associationReason,
                associatedBy: paymentRecord.associatedBy || "system",
                asOf: paymentRecord.paidAt
            }).catch((err) => {
                logger_1.logger.warn({ err, paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId }, "processWompiEvent: fallo reconciliando pago aprobado con ciclos");
                return null;
            });
        }
        if (paymentRecord.subscriptionId && paymentRecord.wompiPaymentLinkId && paymentRecord.checkoutUrl) {
            const planId = subscription?.planId ??
                (await db.subscription.findUnique({ where: { id: paymentRecord.subscriptionId }, select: { planId: true } }))?.planId;
            const productId = subscription?.productId ??
                (await db.subscription.findUnique({ where: { id: paymentRecord.subscriptionId }, select: { productId: true } }))?.productId ??
                (String(subscription?.plan?.catalogProductId || subscription?.plan?.metadata?.catalog?.itemId || "").trim() || null);
            if (planId) {
                await db.paymentLink
                    .upsert({
                    where: { paymentId: paymentRecord.id },
                    create: {
                        tenantId: tenantIdForPayment,
                        planId,
                        productId,
                        subscriptionId: paymentRecord.subscriptionId,
                        paymentId: paymentRecord.id,
                        wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
                        checkoutUrl: paymentRecord.checkoutUrl,
                        status: paymentRecord.status === client_2.PaymentStatus.APPROVED ? client_2.PaymentLinkStatus.PAID : client_2.PaymentLinkStatus.SENT,
                        sentAt: new Date(),
                        paidAt: paymentRecord.paidAt ?? null
                    },
                    update: {
                        ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
                        planId,
                        productId,
                        subscriptionId: paymentRecord.subscriptionId,
                        wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
                        checkoutUrl: paymentRecord.checkoutUrl,
                        status: paymentRecord.status === client_2.PaymentStatus.APPROVED ? client_2.PaymentLinkStatus.PAID : undefined,
                        paidAt: paymentRecord.paidAt ?? null
                    }
                })
                    .catch((err) => {
                    logger_1.logger.warn({ err, paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId }, "processWompiEvent: fallo sincronizando paymentLink");
                });
            }
        }
        await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "webhooks.wompi", "Webhook conciliado", {
            webhookEventId,
            paymentId: paymentRecord.id,
            paymentStatus: paymentRecord.status,
            wompiTransactionId: paymentRecord.wompiTransactionId,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            reference: paymentRecord.reference,
            subscriptionId: paymentRecord.subscriptionId
        }, "webhook:wompi").catch((err) => {
            logger_1.logger.warn({ err, webhookEventId, paymentId: paymentRecord.id }, "processWompiEvent: fallo escribiendo systemLog de webhook conciliado");
        });
        void (0, realtimePublisher_1.publishRealtime)("payments", {
            type: "payment_status",
            paymentId: paymentRecord.id,
            status: paymentRecord.status,
            wompiTransactionId: paymentRecord.wompiTransactionId,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            reference: paymentRecord.reference,
            subscriptionId: paymentRecord.subscriptionId,
            customerId: paymentRecord.customerId,
            amountInCents: paymentRecord.amountInCents,
            updatedAt: new Date().toISOString()
        });
        await db.webhookEvent.update({
            where: { id: webhookEventId },
            data: { processStatus: client_2.WebhookProcessStatus.PROCESSED, processedAt: new Date() }
        });
        const paymentNotificationSchedule = await (0, notificationsScheduler_1.schedulePaymentStatusNotifications)({
            paymentId: paymentRecord.id,
            forceNow: true
        }).catch((err) => {
            (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "notifications.payment_status", "Fallo al programar notificaciones de pago", {
                paymentId: paymentRecord.id,
                error: String(err?.message || err)
            }, "webhook:wompi").catch((logErr) => {
                logger_1.logger.warn({ err: logErr, paymentId: paymentRecord.id }, "processWompiEvent: fallo escribiendo systemLog de notificaciones de pago");
            });
            return null;
        });
        const paymentNotificationError = paymentNotificationSchedule
            ? (0, notificationDelivery_1.firstNotificationDeliveryError)(paymentNotificationSchedule)
            : null;
        const paymentNotificationSummary = {
            scheduled: Number(paymentNotificationSchedule?.scheduled || 0),
            sentNow: Number(paymentNotificationSchedule?.sentNow || 0),
            rulesActive: Boolean(paymentNotificationSchedule?.rulesActive)
        };
        if (paymentNotificationError) {
            await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "notifications.payment_status", "Notificación de pago sin entrega inmediata", {
                paymentId: paymentRecord.id,
                status: paymentRecord.status,
                error: paymentNotificationError,
                notificationsScheduled: paymentNotificationSummary.scheduled,
                notificationsSent: paymentNotificationSummary.sentNow,
                notificationsRulesActive: paymentNotificationSummary.rulesActive
            }, "webhook:wompi").catch((logErr) => {
                logger_1.logger.warn({ err: logErr, paymentId: paymentRecord.id }, "processWompiEvent: fallo escribiendo systemLog de no entrega de notificación");
            });
        }
        await (0, chatwootSync_1.syncChatwootAttributesForCustomer)(paymentRecord.customerId).catch((err) => {
            (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "chatwoot.sync", "Fallo al sincronizar atributos de Chatwoot", {
                customerId: paymentRecord.customerId,
                error: String(err?.message || err)
            }, "webhook:wompi").catch((logErr) => {
                logger_1.logger.warn({ err: logErr, customerId: paymentRecord.customerId }, "processWompiEvent: fallo escribiendo systemLog de sync Chatwoot");
            });
        });
        const becameApproved = !wasApproved && nextStatus === client_2.PaymentStatus.APPROVED;
        const becameFailed = !wasFailed && (nextStatus === client_2.PaymentStatus.DECLINED || nextStatus === client_2.PaymentStatus.ERROR || nextStatus === client_2.PaymentStatus.VOIDED);
        if (becameApproved) {
            await (0, superAdminApp_1.consumeApp)("payments_success", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
            void (0, realtimePublisher_1.publishRealtime)("payments", {
                type: "payment_approved",
                paymentId: paymentRecord.id,
                status: paymentRecord.status,
                subscriptionId: paymentRecord.subscriptionId,
                customerId: paymentRecord.customerId,
                amountInCents: paymentRecord.amountInCents,
                paidAt: paymentRecord.paidAt || null,
                updatedAt: new Date().toISOString()
            });
        }
        else if (becameFailed) {
            await (0, superAdminApp_1.consumeApp)("payments_failed", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
            void (0, realtimePublisher_1.publishRealtime)("payments", {
                type: "payment_failed",
                paymentId: paymentRecord.id,
                status: paymentRecord.status,
                subscriptionId: paymentRecord.subscriptionId,
                customerId: paymentRecord.customerId,
                amountInCents: paymentRecord.amountInCents,
                updatedAt: new Date().toISOString()
            });
        }
        if (becameFailed) {
            const failureMessage = extractFailureMessage(payload);
            const lastAttempt = await db.paymentAttempt.findFirst({
                where: { paymentId: paymentRecord.id },
                orderBy: { attemptNo: "desc" },
                select: { attemptNo: true }
            });
            const nextAttemptNo = Number.isFinite(lastAttempt?.attemptNo) ? (lastAttempt.attemptNo + 1) : 1;
            await db.paymentAttempt.create({
                data: {
                    paymentId: paymentRecord.id,
                    attemptNo: nextAttemptNo,
                    status: "TRANSACTION_DECLINED",
                    provider: "wompi",
                    reference: reference ?? null,
                    errorCode: nextStatus || "DECLINED",
                    errorMessage: failureMessage || "Pago rechazado por el emisor.",
                    response: payload
                }
            }).catch((err) => {
                logger_1.logger.warn({ err, paymentId: paymentRecord.id }, "processWompiEvent: fallo creando paymentAttempt fallido");
            });
        }
        if (becameApproved) {
            await (0, gamification_1.applyGamificationEvent)({
                entityType: client_1.GamificationEntityType.CUSTOMER,
                entityId: paymentRecord.customerId,
                tenantId: tenantIdForPayment,
                kind: gamification_1.GAMIFICATION_EVENT_KINDS.PAYMENT_APPROVED,
                moneyInCents: paymentRecord.amountInCents,
                metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
            }).catch((err) => {
                logger_1.logger.warn({ err, paymentId: paymentRecord.id, customerId: paymentRecord.customerId }, "processWompiEvent: fallo aplicando gamificación a customer por pago aprobado");
            });
            const productId = subscription?.productId ?? (String(subscription?.plan?.catalogProductId || subscription?.plan?.metadata?.catalog?.itemId || "").trim() || null);
            if (productId) {
                const moneyPts = (0, gamificationConfig_1.moneyToPoints)(paymentRecord.amountInCents, gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentApproved.moneyScale);
                await (0, gamification_1.applyGamificationEvent)({
                    entityType: client_1.GamificationEntityType.PRODUCT,
                    entityId: productId,
                    tenantId: tenantIdForPayment,
                    kind: "product.payment.approved",
                    moneyInCents: paymentRecord.amountInCents,
                    statusDelta: gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentApproved.status + moneyPts,
                    lifetimeDelta: gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentApproved.lifetime + moneyPts,
                    metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
                }).catch((err) => {
                    logger_1.logger.warn({ err, paymentId: paymentRecord.id, productId }, "processWompiEvent: fallo aplicando gamificación a producto por pago aprobado");
                });
            }
        }
        else if (becameFailed) {
            await (0, gamification_1.applyGamificationEvent)({
                entityType: client_1.GamificationEntityType.CUSTOMER,
                entityId: paymentRecord.customerId,
                tenantId: tenantIdForPayment,
                kind: gamification_1.GAMIFICATION_EVENT_KINDS.PAYMENT_FAILED,
                moneyInCents: paymentRecord.amountInCents,
                metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
            }).catch((err) => {
                logger_1.logger.warn({ err, paymentId: paymentRecord.id, customerId: paymentRecord.customerId }, "processWompiEvent: fallo aplicando gamificación a customer por pago fallido");
            });
            const productId = subscription?.productId ?? (String(subscription?.plan?.catalogProductId || subscription?.plan?.metadata?.catalog?.itemId || "").trim() || null);
            if (productId) {
                await (0, gamification_1.applyGamificationEvent)({
                    entityType: client_1.GamificationEntityType.PRODUCT,
                    entityId: productId,
                    tenantId: tenantIdForPayment,
                    kind: "product.payment.failed",
                    moneyInCents: paymentRecord.amountInCents,
                    statusDelta: gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentFailed.status,
                    lifetimeDelta: gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentFailed.lifetime,
                    metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
                }).catch((err) => {
                    logger_1.logger.warn({ err, paymentId: paymentRecord.id, productId }, "processWompiEvent: fallo aplicando gamificación a producto por pago fallido");
                });
            }
        }
        if (nextStatus === client_2.PaymentStatus.APPROVED && subscription) {
            await (0, billingCycles_1.syncSubscriptionBillingSnapshot)({ subscriptionId: subscription.id, asOf: paidAt ?? undefined }).catch((err) => {
                logger_1.logger.warn({ err, subscriptionId: subscription.id }, "processWompiEvent: fallo sincronizando snapshot tras pago");
            });
            const state = approvedBillingReconciliation?.state ??
                (await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: subscription.id, asOf: paidAt ?? undefined }).catch(() => null));
            const nextRunAt = state?.collectionCycle?.dueAt ? new Date(state.collectionCycle.dueAt) : null;
            const collectionMode = (0, subscriptionMode_1.resolveSubscriptionCollectionMode)(subscription);
            const advancedTo = nextRunAt ? { nextRunAt } : null;
            if (nextRunAt && (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK")) {
                await (0, retryJobScheduler_1.ensurePaymentRetryJob)({
                    subscriptionId: subscription.id,
                    runAt: nextRunAt,
                    maxAttempts: 1
                }).catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: subscription.id }, "Fallo agendando próximo cobro tras pago aprobado");
                });
            }
            // Notificaciones: la confirmación de pago se maneja por reglas (PAYMENT_APPROVED).
            if (advancedTo) {
                await (0, notificationsScheduler_1.scheduleSubscriptionDueNotifications)({ subscriptionId: subscription.id }).catch((err) => {
                    logger_1.logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando recordatorios tras pago aprobado");
                });
            }
        }
    }
    finally {
        await db.$queryRaw `SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch((err) => {
            logger_1.logger.warn({ err, webhookEventId }, "processWompiEvent: fallo liberando advisory lock");
        });
    }
}
async function processWompiEvent(webhookEventId) {
    return processWompiEventLogic(webhookEventId, prisma_1.prisma);
}
async function forwardWompiToShopify(webhookEventId) {
    const cfg = await (0, runtimeConfig_1.getShopifyForward)();
    if (!cfg.url)
        return;
    const event = await prisma_1.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event)
        return;
    const raw = (event.payload && typeof event.payload === "object"
        ? event.payload
        : {});
    const data = raw && typeof raw === "object" ? raw.data : undefined;
    const transaction = data && typeof data === "object" ? data.transaction : undefined;
    const dataRecord = data && typeof data === "object" ? data : null;
    const txRecord = transaction && typeof transaction === "object" ? transaction : null;
    const checksum = String(event.checksum || raw?.signature?.checksum || "").trim();
    const origin = cfg.origin === "shopify-native" ? "shopify-native" : "shopify";
    const normalizeRef = (value) => (value == null ? "" : String(value).trim());
    const transactionId = normalizeRef(txRecord?.id);
    const paymentLinkId = normalizeRef(txRecord?.payment_link_id) ||
        normalizeRef(txRecord?.payment_link?.id) ||
        normalizeRef(dataRecord?.payment_link_id);
    let reference = normalizeRef(txRecord?.reference || dataRecord?.reference || raw?.reference);
    if (!reference) {
        if (transactionId) {
            const payment = await prisma_1.prisma.payment.findFirst({
                where: { wompiTransactionId: transactionId },
                select: { reference: true }
            });
            reference = normalizeRef(payment?.reference);
        }
        if (!reference && paymentLinkId) {
            const payment = await prisma_1.prisma.payment.findFirst({
                where: { wompiPaymentLinkId: paymentLinkId },
                select: { reference: true }
            });
            reference = normalizeRef(payment?.reference);
        }
    }
    if (!reference) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "shopify.forward", "Forward skipped (missing reference)", {
            webhookEventId,
            transactionId: transactionId || null,
            paymentLinkId: paymentLinkId || null,
            url: cfg.url
        }, "webhook:wompi").catch((err) => {
            logger_1.logger.warn({ err, webhookEventId, transactionId, paymentLinkId }, "processWompiEvent: fallo escribiendo systemLog de forward sin referencia");
        });
        return;
    }
    const normalizedTx = transaction && typeof transaction === "object"
        ? {
            ...txRecord,
            origin: txRecord?.origin ?? origin,
            ...(reference && !txRecord?.reference ? { reference } : {})
        }
        : transaction;
    const normalizedData = data && typeof data === "object"
        ? {
            ...dataRecord,
            origin: dataRecord?.origin ?? origin,
            ...(reference && !dataRecord?.reference ? { reference } : {}),
            transaction: normalizedTx
        }
        : data;
    const payload = {
        ...(raw && typeof raw === "object" ? raw : {}),
        origin: raw?.origin ?? origin,
        sent_at: raw?.sent_at ?? new Date().toISOString(),
        ...(reference && !raw?.reference ? { reference } : {}),
        data: normalizedData
    };
    const res = await (0, http_1.postJson)(cfg.url, payload, {
        "x-forwarded-by": "wompi-subs-api",
        ...(checksum ? { "x-event-checksum": checksum, "x-wompi-checksum": checksum } : {}),
        ...(cfg.secret ? { "x-forwarded-secret": cfg.secret } : {})
    });
    if (!res.ok) {
        const bodyText = res.text || "";
        await (0, systemLog_1.systemLog)(client_1.LogLevel.ERROR, "shopify.forward", "Forward failed", {
            webhookEventId,
            status: res.status,
            body: bodyText.slice(0, 2000),
            url: cfg.url
        }, "webhook:wompi").catch((err) => {
            logger_1.logger.warn({ err, webhookEventId, status: res.status }, "processWompiEvent: fallo escribiendo systemLog de Shopify forward fallido");
        });
        throw new Error(`forward failed: ${res.status} ${bodyText}`);
    }
    await (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "shopify.forward", "Forward delivered", {
        webhookEventId,
        url: cfg.url,
        reference: reference || null,
        transactionId: transactionId || null,
        paymentLinkId: paymentLinkId || null,
        status: res.status
    }, "webhook:wompi").catch((err) => {
        logger_1.logger.warn({ err, webhookEventId, status: res.status }, "processWompiEvent: fallo escribiendo systemLog de Shopify forward exitoso");
    });
}
