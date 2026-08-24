"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHATWOOT_CUSTOM_ATTR_DEFS = void 0;
exports.isValidWhatsappSourceId = isValidWhatsappSourceId;
exports.normalizeWhatsappSourceId = normalizeWhatsappSourceId;
exports.ensureChatwootCustomAttributes = ensureChatwootCustomAttributes;
exports.ensureChatwootContactForCustomer = ensureChatwootContactForCustomer;
exports.syncChatwootAttributesForCustomer = syncChatwootAttributesForCustomer;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const prisma_1 = require("../db/prisma");
const logger_1 = require("../lib/logger");
const billingCycles_1 = require("./billingCycles");
const client_2 = require("../providers/chatwoot/client");
const runtimeConfig_1 = require("./runtimeConfig");
const systemLog_1 = require("./systemLog");
// Chatwoot valida el source_id de un inbox de WhatsApp contra /\A\d{1,15}\z/.
// Los source_id con formato UUID vienen de otros canales (widget/API) y ahí son inválidos.
function isValidWhatsappSourceId(value) {
    return typeof value === "string" && /^\d{1,15}$/.test(value.trim());
}
// Convierte el teléfono del CRM a E.164 sin '+'. Los celulares colombianos llegan
// en 10 dígitos empezando por 3, así que se les antepone el indicativo 57.
function normalizeWhatsappSourceId(rawPhone) {
    const digits = String(rawPhone ?? "").replace(/\D/g, "");
    if (!digits)
        return undefined;
    const candidate = digits.length === 10 && digits.startsWith("3") ? `57${digits}` : digits;
    return isValidWhatsappSourceId(candidate) ? candidate : undefined;
}
exports.CHATWOOT_CUSTOM_ATTR_DEFS = [
    { key: "customer_id", displayName: "Customer ID", displayType: "text" },
    { key: "tenant_id", displayName: "Tenant ID", displayType: "text" },
    { key: "tenant_name", displayName: "Tenant Name", displayType: "text" },
    { key: "customer_name", displayName: "Customer Name", displayType: "text" },
    { key: "customer_email", displayName: "Customer Email", displayType: "text" },
    { key: "customer_phone", displayName: "Customer Phone", displayType: "text" },
    { key: "customer_created_at", displayName: "Customer Created", displayType: "date" },
    { key: "customer_updated_at", displayName: "Customer Updated", displayType: "date" },
    { key: "customer_metadata", displayName: "Customer Metadata", displayType: "text" },
    { key: "subscription_id", displayName: "Subscription ID", displayType: "text" },
    { key: "subscription_status", displayName: "Subscription Status", displayType: "list", values: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"] },
    { key: "subscription_start_at", displayName: "Subscription Start", displayType: "date" },
    { key: "subscription_period_start", displayName: "Period Start", displayType: "date" },
    { key: "subscription_period_end", displayName: "Period End", displayType: "date" },
    { key: "subscription_cycle", displayName: "Subscription Cycle", displayType: "number" },
    { key: "subscription_retry_count", displayName: "Retry Count", displayType: "number" },
    { key: "subscription_max_retries", displayName: "Max Retries", displayType: "number" },
    { key: "subscription_canceled_at", displayName: "Canceled At", displayType: "date" },
    { key: "subscription_suspended_at", displayName: "Suspended At", displayType: "date" },
    { key: "subscription_metadata", displayName: "Subscription Metadata", displayType: "text" },
    { key: "plan_id", displayName: "Plan ID", displayType: "text" },
    { key: "plan_name", displayName: "Plan Name", displayType: "text" },
    { key: "plan_price", displayName: "Plan Price (cents)", displayType: "number" },
    { key: "plan_currency", displayName: "Plan Currency", displayType: "text" },
    { key: "plan_interval_unit", displayName: "Plan Interval Unit", displayType: "text" },
    { key: "plan_interval_count", displayName: "Plan Interval Count", displayType: "number" },
    { key: "plan_type", displayName: "Plan Type", displayType: "text" },
    { key: "plan_active", displayName: "Plan Active", displayType: "boolean" },
    { key: "plan_metadata", displayName: "Plan Metadata", displayType: "text" },
    { key: "has_subscription", displayName: "Has Subscription", displayType: "boolean" },
    { key: "has_active_subscription", displayName: "Has Active Subscription", displayType: "boolean" },
    { key: "next_billing_date", displayName: "Next Billing Date", displayType: "date" },
    { key: "days_past_due", displayName: "Days Past Due", displayType: "number" },
    { key: "in_mora", displayName: "In Mora", displayType: "boolean" },
    { key: "last_payment_id", displayName: "Last Payment ID", displayType: "text" },
    { key: "last_payment_status", displayName: "Last Payment Status", displayType: "list", values: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"] },
    { key: "last_payment_amount", displayName: "Last Payment Amount (cents)", displayType: "number" },
    { key: "last_payment_currency", displayName: "Last Payment Currency", displayType: "text" },
    { key: "last_payment_reference", displayName: "Last Payment Reference", displayType: "text" },
    { key: "last_payment_wompi_transaction_id", displayName: "Last Payment Wompi Tx", displayType: "text" },
    { key: "last_payment_checkout_url", displayName: "Last Payment Checkout Url", displayType: "url" },
    { key: "last_payment_paid_at", displayName: "Last Payment Paid At", displayType: "date" },
    { key: "last_payment_failed_at", displayName: "Last Payment Failed At", displayType: "date" },
    { key: "last_payment_created_at", displayName: "Last Payment Created At", displayType: "date" },
    { key: "last_payment_metadata", displayName: "Last Payment Provider Resp", displayType: "text" }
];
let lastEnsureAt = 0;
let lastEnsureOk = false;
async function ensureCustomAttributes(client) {
    const now = Date.now();
    if (lastEnsureOk && now - lastEnsureAt < 10 * 60 * 1000)
        return { ok: true };
    lastEnsureAt = now;
    try {
        const list = await client.listCustomAttributes("contact");
        const rawPayload = Array.isArray(list.raw?.payload) ? list.raw.payload : [];
        const existing = new Set(rawPayload
            .map((item) => (item && typeof item === "object" ? item : {}))
            .map((a) => String(a.attribute_key || a.attributeKey || "")));
        for (const def of exports.CHATWOOT_CUSTOM_ATTR_DEFS) {
            if (existing.has(def.key))
                continue;
            try {
                await client.createCustomAttribute({ ...def, model: "contact" });
            }
            catch (err) {
                const msg = String(err?.message || "");
                if (msg.includes("already been taken") || msg.includes("Attribute key has already been taken")) {
                    continue;
                }
                throw err;
            }
        }
        lastEnsureOk = true;
        return { ok: true };
    }
    catch (err) {
        lastEnsureOk = false;
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "chatwoot.sync", "No se pudieron asegurar atributos", {
            err: err?.message ? String(err.message) : "unknown_error"
        }).catch((logErr) => {
            logger_1.logger.warn({ err: logErr }, "chatwoot.sync: failed to write system log");
        });
        return { ok: false };
    }
}
async function ensureChatwootCustomAttributes() {
    const cfg = await (0, runtimeConfig_1.getChatwootConfig)();
    if (!cfg.configured)
        return { ok: false, reason: "chatwoot_not_configured" };
    const client = new client_2.ChatwootClient({
        baseUrl: cfg.baseUrl,
        accountId: cfg.accountId,
        apiAccessToken: cfg.apiAccessToken,
        inboxId: cfg.inboxId
    });
    return ensureCustomAttributes(client);
}
async function ensureChatwootContactForCustomer(customerId, opts) {
    const id = String(customerId || "").trim();
    if (!id)
        return { ok: false, reason: "missing_customer_id" };
    const customer = await prisma_1.prisma.customer.findUnique({ where: { id } });
    if (!customer)
        return { ok: false, reason: "customer_not_found" };
    if (!customer.phone) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "chatwoot.sync", "Cliente sin teléfono, se requiere para sincronizar", {
            customerId: customer.id
        }).catch((logErr) => {
            logger_1.logger.warn({ err: logErr, customerId: customer.id }, "chatwoot.sync: failed to write system log");
        });
        return { ok: false, reason: "customer_phone_required" };
    }
    const cfg = await (0, runtimeConfig_1.getChatwootConfig)();
    if (!cfg.configured) {
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "chatwoot.sync", "Chatwoot no configurado", { customerId: customer.id }).catch((logErr) => {
            logger_1.logger.warn({ err: logErr, customerId: customer.id }, "chatwoot.sync: failed to write system log");
        });
        return { ok: false, reason: "chatwoot_not_configured" };
    }
    const meta = (customer.metadata ?? {});
    const existingContactId = meta?.chatwoot?.contactId;
    const existingSourceId = meta?.chatwoot?.sourceId;
    const nextSnapshot = {
        name: customer.name ?? null,
        email: customer.email ?? null,
        phone: customer.phone ?? null
    };
    const prevSnapshot = meta?.chatwoot?.contactSnapshot;
    const snapshotEqual = prevSnapshot &&
        prevSnapshot.name === nextSnapshot.name &&
        prevSnapshot.email === nextSnapshot.email &&
        prevSnapshot.phone === nextSnapshot.phone;
    if (typeof existingContactId === "number" && Number.isFinite(existingContactId)) {
        const client = new client_2.ChatwootClient({
            baseUrl: cfg.baseUrl,
            accountId: cfg.accountId,
            apiAccessToken: cfg.apiAccessToken,
            inboxId: cfg.inboxId
        });
        if (!opts?.skipUpdate && !snapshotEqual) {
            // Ensure latest data always wins.
            await client
                .updateContact(existingContactId, {
                name: customer.name || undefined,
                email: customer.email || undefined,
                phoneNumber: customer.phone || undefined
            })
                .then(() => (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "chatwoot.sync", "Contacto actualizado", {
                customerId: customer.id,
                contactId: existingContactId
            }).catch((logErr) => {
                logger_1.logger.warn({ err: logErr, customerId: customer.id }, "chatwoot.sync: failed to write system log");
            }))
                .catch((err) => {
                logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update contact");
            });
        }
        // Ensure we have a sourceId tied to the inbox.
        // Un inbox de WhatsApp exige source_id (E.164 sin '+'); sin él Chatwoot responde
        // 422 "param is missing: contact phone number" al crear la conversación.
        const whatsappSourceId = normalizeWhatsappSourceId(customer.phone);
        let sourceId = isValidWhatsappSourceId(existingSourceId) ? existingSourceId : undefined;
        if (!sourceId) {
            try {
                const contactInfo = await client.getContact(existingContactId);
                if (isValidWhatsappSourceId(contactInfo.sourceId))
                    sourceId = contactInfo.sourceId;
            }
            catch (err) {
                logger_1.logger.warn({ err, customerId: customer.id, contactId: existingContactId }, "chatwoot.sync: getContact falló resolviendo sourceId");
            }
            if (!sourceId) {
                try {
                    const createdInbox = await client.createContactInbox(existingContactId, whatsappSourceId);
                    sourceId = createdInbox.sourceId;
                }
                catch (err) {
                    logger_1.logger.warn({ err, customerId: customer.id, contactId: existingContactId, whatsappSourceId }, "chatwoot.sync: createContactInbox falló; el contacto quedará sin canal de WhatsApp");
                }
            }
        }
        if (sourceId && (sourceId !== existingSourceId || !snapshotEqual)) {
            const merged = {
                ...(meta && typeof meta === "object" ? meta : {}),
                chatwoot: { ...(meta?.chatwoot || {}), contactId: existingContactId, sourceId, contactSnapshot: nextSnapshot }
            };
            await prisma_1.prisma.customer.update({
                where: { id: customer.id },
                data: { metadata: merged }
            }).catch((err) => {
                logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update customer metadata");
            });
        }
        else if (!snapshotEqual) {
            const merged = {
                ...(meta && typeof meta === "object" ? meta : {}),
                chatwoot: { ...(meta?.chatwoot || {}), contactId: existingContactId, sourceId: existingSourceId, contactSnapshot: nextSnapshot }
            };
            await prisma_1.prisma.customer.update({
                where: { id: customer.id },
                data: { metadata: merged }
            }).catch((err) => {
                logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update customer metadata");
            });
        }
        return { ok: true, contactId: existingContactId, sourceId };
    }
    const client = new client_2.ChatwootClient({
        baseUrl: cfg.baseUrl,
        accountId: cfg.accountId,
        apiAccessToken: cfg.apiAccessToken,
        inboxId: cfg.inboxId
    });
    // Search first so repeated sends reuse the existing Chatwoot contact instead of racing contact creation.
    await ensureCustomAttributes(client);
    const queries = client.buildSearchQueries({ email: customer.email || undefined, phoneNumber: customer.phone || undefined });
    for (const q of queries) {
        const found = await client.searchContact(q).catch(() => null);
        if (!found?.contactId)
            continue;
        if (!opts?.skipUpdate && !snapshotEqual) {
            await client
                .updateContact(found.contactId, {
                name: customer.name || undefined,
                email: customer.email || undefined,
                phoneNumber: customer.phone || undefined
            })
                .catch((err) => {
                logger_1.logger.warn({ err, customerId: customer.id, contactId: found.contactId }, "chatwoot.sync: failed to update searched contact");
            });
        }
        let sourceId = existingSourceId;
        if (!sourceId) {
            try {
                const contactInfo = await client.getContact(found.contactId);
                sourceId = contactInfo.sourceId;
            }
            catch {
                // ignore
            }
        }
        if (!sourceId) {
            try {
                const createdInbox = await client.createContactInbox(found.contactId);
                sourceId = createdInbox.sourceId;
            }
            catch {
                // ignore
            }
        }
        const merged = {
            ...(meta && typeof meta === "object" ? meta : {}),
            chatwoot: { ...(meta?.chatwoot || {}), contactId: found.contactId, sourceId, contactSnapshot: nextSnapshot }
        };
        await prisma_1.prisma.customer.update({
            where: { id: customer.id },
            data: { metadata: merged }
        }).catch((err) => {
            logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update customer metadata");
        });
        return { ok: true, contactId: found.contactId, sourceId };
    }
    let created = null;
    try {
        created = await client.createContact({
            name: customer.name || undefined,
            email: customer.email || undefined,
            phoneNumber: customer.phone || undefined
        });
    }
    catch (err) {
        // If contact exists already, retry search by normalized phone/email.
        const createError = err?.message ? String(err.message) : "unknown error";
        for (const q of queries) {
            const found = await client.searchContact(q).catch(() => null);
            if (!found?.contactId)
                continue;
            if (!opts?.skipUpdate && !snapshotEqual) {
                await client
                    .updateContact(found.contactId, {
                    name: customer.name || undefined,
                    email: customer.email || undefined,
                    phoneNumber: customer.phone || undefined
                })
                    .then(() => (0, systemLog_1.systemLog)(client_1.LogLevel.INFO, "chatwoot.sync", "Contacto actualizado", {
                    customerId: customer.id,
                    contactId: found.contactId
                }).catch((logErr) => {
                    logger_1.logger.warn({ err: logErr, customerId: customer.id }, "chatwoot.sync: failed to write system log");
                }))
                    .catch((err) => {
                    logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update contact");
                });
            }
            let sourceId = existingSourceId;
            if (!sourceId) {
                try {
                    const contactInfo = await client.getContact(found.contactId);
                    sourceId = contactInfo.sourceId;
                }
                catch {
                    // ignore
                }
            }
            if (!sourceId) {
                try {
                    const createdInbox = await client.createContactInbox(found.contactId);
                    sourceId = createdInbox.sourceId;
                }
                catch {
                    // ignore
                }
            }
            const merged = {
                ...(meta && typeof meta === "object" ? meta : {}),
                chatwoot: { ...(meta?.chatwoot || {}), contactId: found.contactId, sourceId, contactSnapshot: nextSnapshot }
            };
            await prisma_1.prisma.customer.update({
                where: { id: customer.id },
                data: { metadata: merged }
            }).catch((err) => {
                logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update customer metadata");
            });
            return { ok: true, contactId: found.contactId, sourceId };
        }
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "chatwoot.sync", "Could not create/search contact for customer", {
            customerId: customer.id,
            err: createError,
            phone: customer.phone || null,
            email: customer.email || null,
            searchQueries: queries
        }).catch((logErr) => {
            logger_1.logger.warn({ err: logErr, customerId: customer.id }, "chatwoot.sync: failed to write system log");
        });
        return { ok: false, reason: "create_or_search_failed", detail: createError, searchQueries: queries };
    }
    if (!created?.contactId)
        return { ok: false, reason: "create_failed" };
    const merged = {
        ...(meta && typeof meta === "object" ? meta : {}),
        chatwoot: { ...(meta?.chatwoot || {}), contactId: created.contactId, sourceId: created.sourceId, contactSnapshot: nextSnapshot }
    };
    await prisma_1.prisma.customer.update({
        where: { id: customer.id },
        data: { metadata: merged }
    }).catch((err) => {
        logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update customer metadata");
    });
    return { ok: true, contactId: created.contactId, sourceId: created.sourceId };
}
async function syncChatwootAttributesForCustomer(customerId) {
    const id = String(customerId || "").trim();
    if (!id)
        return { ok: false, reason: "missing_customer_id" };
    const customer = await prisma_1.prisma.customer.findUnique({
        where: { id },
        include: {
            tenant: true,
            subscriptions: {
                include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
                orderBy: { createdAt: "desc" }
            },
            payments: { orderBy: { createdAt: "desc" }, take: 1 }
        }
    });
    if (!customer)
        return { ok: false, reason: "customer_not_found" };
    const cfg = await (0, runtimeConfig_1.getChatwootConfig)();
    if (!cfg.configured)
        return { ok: false, reason: "chatwoot_not_configured" };
    const meta = (customer.metadata ?? {});
    const ensured = await ensureChatwootContactForCustomer(customer.id, { skipUpdate: true });
    if (!ensured.ok)
        return ensured;
    const sub = customer.subscriptions?.[0] || null;
    const latestPayment = customer.payments?.[0] || sub?.payments?.[0] || null;
    const billingState = sub ? await (0, billingCycles_1.resolveSubscriptionBillingState)({ subscriptionId: sub.id }) : null;
    const activeCycle = billingState?.activeCycle || null;
    const collectionCycle = billingState?.collectionCycle || activeCycle;
    const currentPeriodStartAt = activeCycle?.periodStartAt ? new Date(activeCycle.periodStartAt) : null;
    const currentPeriodEndAt = activeCycle?.periodEndAt ? new Date(activeCycle.periodEndAt) : null;
    const nextBillingDate = collectionCycle?.dueAt ? new Date(collectionCycle.dueAt) : currentPeriodEndAt;
    const now = Date.now();
    const daysPastDue = nextBillingDate && nextBillingDate.getTime() < now
        ? Math.floor((now - nextBillingDate.getTime()) / 86_400_000)
        : 0;
    const safeJson = (value) => {
        if (!value || typeof value !== "object")
            return null;
        try {
            const json = JSON.stringify(value);
            if (json.length <= 1000)
                return json;
            return json.slice(0, 1000);
        }
        catch {
            return null;
        }
    };
    // La mora se mide por el ciclo más antiguo SIN pagar (vencido), no por el
    // collectionCycle (en curso, aún no vencido). Igual que subscriptionQueries.ts.
    const delinquencyCycle = billingState?.oldestUnpaidCycle && !(0, billingCycles_1.isBillingCyclePaid)(billingState.oldestUnpaidCycle)
        ? billingState.oldestUnpaidCycle
        : collectionCycle;
    const collectionState = (0, billingCycles_1.resolveCollectionDelinquency)({
        cycle: delinquencyCycle,
        graceDays: sub?.graceDays,
        fallbackSubscriptionStatus: sub?.status ?? null
    });
    const customAttributes = {
        customer_id: customer.id,
        tenant_id: customer.tenantId ?? null,
        tenant_name: customer.tenant?.name ?? null,
        customer_name: customer.name ?? null,
        customer_email: customer.email ?? null,
        customer_phone: customer.phone ?? null,
        customer_created_at: customer.createdAt ? new Date(customer.createdAt).toISOString() : null,
        customer_updated_at: customer.updatedAt ? new Date(customer.updatedAt).toISOString() : null,
        customer_metadata: safeJson(customer.metadata),
        subscription_id: sub?.id ?? null,
        subscription_status: sub?.status ?? null,
        subscription_start_at: sub?.startAt ? new Date(sub.startAt).toISOString() : null,
        subscription_period_start: currentPeriodStartAt ? currentPeriodStartAt.toISOString() : null,
        subscription_period_end: currentPeriodEndAt ? currentPeriodEndAt.toISOString() : null,
        subscription_cycle: activeCycle?.cycleNumber ?? null,
        subscription_retry_count: sub?.retryCount ?? null,
        subscription_max_retries: sub?.maxRetries ?? null,
        subscription_canceled_at: sub?.canceledAt ? new Date(sub.canceledAt).toISOString() : null,
        subscription_suspended_at: sub?.suspendedAt ? new Date(sub.suspendedAt).toISOString() : null,
        subscription_metadata: safeJson(sub?.metadata ?? null),
        plan_id: sub?.plan?.id ?? null,
        plan_name: sub?.plan?.name ?? null,
        plan_price: sub?.plan?.priceInCents ?? null,
        plan_currency: sub?.plan?.currency ?? null,
        plan_interval_unit: sub?.plan?.intervalUnit ?? null,
        plan_interval_count: sub?.plan?.intervalCount ?? null,
        plan_type: sub?.plan?.planType ?? null,
        plan_active: typeof sub?.plan?.active === "boolean" ? sub?.plan?.active : null,
        plan_metadata: safeJson(sub?.plan?.metadata ?? null),
        has_subscription: Boolean(sub),
        has_active_subscription: sub?.status === "ACTIVE",
        next_billing_date: nextBillingDate ? nextBillingDate.toISOString() : null,
        days_past_due: collectionState.daysPastDue,
        in_mora: collectionState.status === "EN_MORA",
        last_payment_id: latestPayment?.id ?? null,
        last_payment_status: latestPayment?.status ?? null,
        last_payment_amount: latestPayment?.amountInCents ?? null,
        last_payment_currency: latestPayment?.currency ?? null,
        last_payment_reference: latestPayment?.reference ?? null,
        last_payment_wompi_transaction_id: latestPayment?.wompiTransactionId ?? null,
        last_payment_checkout_url: latestPayment?.checkoutUrl ?? null,
        last_payment_paid_at: latestPayment?.paidAt ? new Date(latestPayment.paidAt).toISOString() : null,
        last_payment_failed_at: latestPayment?.failedAt ? new Date(latestPayment.failedAt).toISOString() : null,
        last_payment_created_at: latestPayment?.createdAt ? new Date(latestPayment.createdAt).toISOString() : null,
        last_payment_metadata: safeJson(latestPayment?.providerResponse ?? null)
    };
    const customJson = JSON.stringify(customAttributes);
    const nextHash = (0, crypto_1.createHash)("sha1").update(customJson).digest("hex");
    const prevHash = meta?.chatwoot?.attributesHash || null;
    if (prevHash && prevHash === nextHash) {
        return { ok: true, skipped: true, contactId: ensured.contactId, sourceId: ensured.sourceId };
    }
    const client = new client_2.ChatwootClient({
        baseUrl: cfg.baseUrl,
        accountId: cfg.accountId,
        apiAccessToken: cfg.apiAccessToken,
        inboxId: cfg.inboxId
    });
    await ensureCustomAttributes(client);
    await client.updateContact(ensured.contactId, {
        name: customer.name || undefined,
        email: customer.email || undefined,
        phoneNumber: customer.phone || undefined,
        customAttributes
    });
    const merged = {
        ...(customer.metadata && typeof customer.metadata === "object" ? customer.metadata : {}),
        chatwoot: {
            ...(meta?.chatwoot || {}),
            contactId: ensured.contactId,
            ...(ensured.sourceId ? { sourceId: ensured.sourceId } : {}),
            contactSnapshot: { name: customer.name ?? null, email: customer.email ?? null, phone: customer.phone ?? null },
            attributesHash: nextHash,
            attributesSyncedAt: new Date().toISOString()
        }
    };
    await prisma_1.prisma.customer.update({
        where: { id: customer.id },
        data: { metadata: merged }
    }).catch((err) => {
        logger_1.logger.warn({ err, customerId: customer.id }, "chatwoot.sync: failed to update customer metadata");
    });
    return { ok: true, contactId: ensured.contactId, sourceId: ensured.sourceId };
}
