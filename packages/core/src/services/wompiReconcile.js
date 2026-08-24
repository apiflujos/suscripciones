"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileWompiTransaction = reconcileWompiTransaction;
exports.reconcileWompiByReference = reconcileWompiByReference;
const prisma_1 = require("../db/prisma");
const client_1 = require("../providers/wompi/client");
const runtimeConfig_1 = require("../services/runtimeConfig");
const client_2 = require("@prisma/client");
const crypto_1 = require("crypto");
const processWompiEvent_1 = require("../jobs/handlers/processWompiEvent");
const logger_1 = require("../lib/logger");
const tenantContext_1 = require("./tenantContext");
const classifyReference_1 = require("../webhooks/wompi/classifyReference");
const FINAL_WOMPI_STATUSES = new Set(["APPROVED", "DECLINED", "VOIDED", "ERROR"]);
function normalizeStatus(raw) {
    return String(raw || "").trim().toUpperCase();
}
function extractWompiTransactionFromRaw(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const root = raw;
    const direct = root.data;
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
        return direct;
    }
    const alt = root.transaction;
    if (alt && typeof alt === "object" && !Array.isArray(alt)) {
        return alt;
    }
    const nested = root.data?.transaction;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return nested;
    }
    return null;
}
function shouldForwardToShopify(raw) {
    return (0, classifyReference_1.isShopifyLikePayload)(raw);
}
async function reconcileWompiTransaction(args) {
    const txId = String(args.wompiTransactionId || "").trim();
    if (!txId) {
        return { ok: false, reason: "missing_transaction_id" };
    }
    const requestedTenantId = String(args.tenantId || "").trim();
    const tenantId = requestedTenantId || String((await (0, tenantContext_1.getDefaultTenantId)()) || "").trim();
    if (!tenantId) {
        return { ok: false, reason: "missing_tenant" };
    }
    const publicKey = await (0, runtimeConfig_1.getWompiPublicKey)();
    if (!publicKey) {
        return { ok: false, reason: "wompi_public_key_not_configured" };
    }
    const apiBaseUrl = await (0, runtimeConfig_1.getWompiApiBaseUrl)();
    const checkoutLinkBaseUrl = await (0, runtimeConfig_1.getWompiCheckoutLinkBaseUrl)();
    const wompi = new client_1.WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl });
    let tx;
    try {
        tx = await wompi.getTransaction(txId, publicKey);
    }
    catch (err) {
        logger_1.logger.warn({ err }, '[WompiReconcile] Error fetching transaction');
        return { ok: false, reason: "wompi_api_unavailable" };
    }
    const status = normalizeStatus(tx.status);
    if (!FINAL_WOMPI_STATUSES.has(status)) {
        return { ok: false, reason: "status_not_final", status };
    }
    const rawTx = extractWompiTransactionFromRaw(tx.raw);
    const payload = {
        event: "transaction.updated",
        data: {
            transaction: {
                // Prefer the raw Wompi shape so we preserve fields like `status_message`.
                // We still override core identifiers to guarantee normalization.
                ...(rawTx || {}),
                id: tx.id,
                status: tx.status,
                reference: tx.reference,
                amount_in_cents: tx.amountInCents,
                currency: tx.currency,
                payment_link_id: tx.paymentLinkId,
                customer_email: tx.customerEmail
            }
        }
    };
    const checksumPrefix = String(args.checksumPrefix || "reconcile").trim() || "reconcile";
    const event = await prisma_1.prisma.webhookEvent.create({
        data: {
            tenantId,
            provider: client_2.WebhookProvider.WOMPI,
            checksum: `${checksumPrefix}:${tx.id}:${(0, crypto_1.randomUUID)()}`,
            eventName: "transaction.updated",
            payload: payload,
            processStatus: client_2.WebhookProcessStatus.RECEIVED,
            receivedAt: new Date()
        }
    });
    const processNow = args.processNow !== false;
    const shopify = await (0, runtimeConfig_1.getShopifyForward)().catch(() => ({}));
    if (processNow) {
        await (0, processWompiEvent_1.processWompiEventLogic)(event.id, prisma_1.prisma).catch(async (err) => {
            logger_1.logger.warn({ err, webhookEventId: event.id }, "wompiReconcile: fallo procesamiento inline, se intentará encolar");
            await prisma_1.prisma.retryJob
                .create({
                data: {
                    type: client_2.RetryJobType.PROCESS_WOMPI_EVENT,
                    payload: { webhookEventId: event.id }
                }
            })
                .catch((queueErr) => {
                logger_1.logger.warn({ err: queueErr, webhookEventId: event.id }, "wompiReconcile: fallo encolando PROCESS_WOMPI_EVENT");
            });
        });
    }
    else {
        await prisma_1.prisma.retryJob
            .create({
            data: {
                type: client_2.RetryJobType.PROCESS_WOMPI_EVENT,
                payload: { webhookEventId: event.id }
            }
        })
            .catch((err) => {
            logger_1.logger.warn({ err, webhookEventId: event.id }, "wompiReconcile: fallo encolando PROCESS_WOMPI_EVENT diferido");
        });
    }
    if (shopify?.url && shouldForwardToShopify(payload)) {
        await prisma_1.prisma.retryJob
            .create({
            data: {
                type: client_2.RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
                payload: { webhookEventId: event.id },
                maxAttempts: 3
            }
        })
            .catch((err) => {
            logger_1.logger.warn({ err, webhookEventId: event.id }, "wompiReconcile: fallo encolando FORWARD_WOMPI_TO_SHOPIFY");
        });
    }
    return { ok: true, webhookEventId: event.id, status: tx.status, reference: tx.reference };
}
function parseDateLike(input) {
    if (!input)
        return 0;
    const dt = new Date(String(input));
    const ms = dt.getTime();
    return Number.isFinite(ms) ? ms : 0;
}
async function reconcileWompiByReference(args) {
    const reference = String(args.reference || "").trim();
    if (!reference)
        return { ok: false, reason: "missing_reference" };
    const requestedTenantId = String(args.tenantId || "").trim();
    const tenantId = requestedTenantId || String((await (0, tenantContext_1.getDefaultTenantId)()) || "").trim();
    if (!tenantId)
        return { ok: false, reason: "missing_tenant" };
    // FIX: Validar amountInCents si se proporciona (no puede ser 0 o negativo)
    const expectedAmount = args.amountInCents != null ? Math.trunc(Number(args.amountInCents)) : null;
    if (expectedAmount != null && expectedAmount <= 0) {
        logger_1.logger.warn({ amountInCents: args.amountInCents }, '[WompiReconcile] Invalid amountInCents provided');
    }
    const expectedCurrency = String(args.currency || "").trim().toUpperCase();
    const expectedLink = String(args.paymentLinkId || "").trim();
    const publicKey = await (0, runtimeConfig_1.getWompiPublicKey)();
    const privateKey = await (0, runtimeConfig_1.getWompiPrivateKey)();
    if (!publicKey && !privateKey) {
        return { ok: false, reason: "wompi_credentials_not_configured" };
    }
    const apiBaseUrl = await (0, runtimeConfig_1.getWompiApiBaseUrl)();
    const checkoutLinkBaseUrl = await (0, runtimeConfig_1.getWompiCheckoutLinkBaseUrl)();
    const wompi = new client_1.WompiClient({ apiBaseUrl, privateKey: privateKey || "unused", checkoutLinkBaseUrl });
    const listByKey = async (key) => wompi.listTransactionsByReference(reference, key);
    const txs = await (async () => {
        if (publicKey) {
            try {
                const out = await listByKey(publicKey);
                if (out.length)
                    return out;
            }
            catch {
                // Fallback to private key when public-key lookup fails.
            }
        }
        if (privateKey)
            return listByKey(privateKey);
        return [];
    })();
    if (!txs.length)
        return { ok: false, reason: "transaction_not_found_by_reference" };
    const finalStatuses = new Set(["APPROVED", "DECLINED", "VOIDED", "ERROR"]);
    const candidates = txs
        .map((tx) => {
        const status = normalizeStatus(tx.status);
        if (!finalStatuses.has(status))
            return null;
        let score = 0;
        if (expectedLink && String(tx.paymentLinkId || "").trim() === expectedLink)
            score += 100;
        if (expectedCurrency && String(tx.currency || "").trim().toUpperCase() === expectedCurrency)
            score += 20;
        // FIX: Solo sumar puntos por amount si expectedAmount es válido (> 0)
        if (expectedAmount != null && expectedAmount > 0 && Number(tx.amountInCents || 0) === expectedAmount)
            score += 20;
        if (status === "APPROVED")
            score += 10;
        const ts = Math.max(parseDateLike(tx.finalizedAt), parseDateLike(tx.createdAt));
        return { tx, score, ts };
    })
        .filter(Boolean);
    if (!candidates.length)
        return { ok: false, reason: "status_not_final" };
    candidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.ts - a.ts));
    const winner = candidates[0]?.tx;
    if (!winner?.id)
        return { ok: false, reason: "transaction_not_found_by_reference" };
    return reconcileWompiTransaction({
        wompiTransactionId: winner.id,
        tenantId,
        processNow: args.processNow,
        checksumPrefix: args.checksumPrefix || "reconcile-ref"
    });
}
