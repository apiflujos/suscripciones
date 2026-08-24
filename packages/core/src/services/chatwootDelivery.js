"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileChatwootMessageDelivery = reconcileChatwootMessageDelivery;
exports.reconcileRecentChatwootDeliveries = reconcileRecentChatwootDeliveries;
const client_1 = require("@prisma/client");
const prisma_1 = require("../db/prisma");
const client_2 = require("../providers/chatwoot/client");
const runtimeConfig_1 = require("./runtimeConfig");
const systemLog_1 = require("./systemLog");
const logger_1 = require("../lib/logger");
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function stringifyValue(value) {
    if (typeof value === "string")
        return value.trim();
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    return "";
}
function extractErrorStrings(value, out) {
    if (!value)
        return;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed)
            out.push(trimmed);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            extractErrorStrings(item, out);
        return;
    }
    if (typeof value === "object") {
        for (const entry of Object.values(value)) {
            extractErrorStrings(entry, out);
        }
    }
}
function inferMissingTemplateParamFromProcessedParams(processedParams) {
    if (!processedParams)
        return null;
    const sections = [
        ["body", processedParams.body],
        ["header", processedParams.header],
        ["buttons", processedParams.buttons]
    ];
    for (const [section, entries] of sections) {
        if (Array.isArray(entries)) {
            const missingIndex = entries.findIndex((entry) => {
                const rec = asRecord(entry);
                const value = stringifyValue(rec?.parameter ?? rec?.value ?? rec?.text ?? entry);
                return !value;
            });
            if (missingIndex >= 0)
                return `${section}:${missingIndex + 1}`;
            continue;
        }
        const record = asRecord(entries);
        if (!record)
            continue;
        const keys = Object.keys(record).sort((a, b) => Number(a) - Number(b));
        const missingKey = keys.find((key) => !stringifyValue(record[key]));
        if (missingKey) {
            return `${section}:${missingKey}`;
        }
    }
    return null;
}
function resolveProviderError(rawMessage, providerResp) {
    const candidates = [];
    if (rawMessage) {
        extractErrorStrings(rawMessage.content_attributes, candidates);
        extractErrorStrings(rawMessage.additional_attributes, candidates);
        extractErrorStrings(rawMessage.errors, candidates);
        extractErrorStrings(rawMessage.external_source_ids, candidates);
    }
    if (providerResp) {
        extractErrorStrings(providerResp.error, candidates);
        const response = asRecord(providerResp.response);
        if (response) {
            extractErrorStrings(response.content_attributes, candidates);
            extractErrorStrings(response.additional_attributes, candidates);
            extractErrorStrings(response.errors, candidates);
        }
    }
    const normalized = Array.from(new Set(candidates.map((entry) => entry.replace(/\s+/g, " ").trim()).filter(Boolean)));
    if (normalized.length)
        return normalized.join(" | ");
    const processedParams = asRecord(asRecord(providerResp?.template_params)?.processed_params);
    const missing = inferMissingTemplateParamFromProcessedParams(processedParams);
    return missing ? `missing_template_param_inferred:${missing}` : null;
}
function resolveDeliveryState(rawMessage) {
    const rawStatus = stringifyValue(rawMessage?.status).toLowerCase();
    if (!rawStatus)
        return { state: "unknown", providerStatus: null };
    if (["failed", "error"].includes(rawStatus))
        return { state: "failed", providerStatus: rawStatus };
    if (["delivered", "read"].includes(rawStatus))
        return { state: "delivered", providerStatus: rawStatus };
    if (["sent", "pending"].includes(rawStatus))
        return { state: "submitted", providerStatus: rawStatus };
    return { state: "unknown", providerStatus: rawStatus };
}
function extractMessageCandidates(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => asRecord(entry)).filter(Boolean);
    }
    const record = asRecord(value);
    if (!record)
        return [];
    const payload = record.payload;
    if (Array.isArray(payload)) {
        return payload.map((entry) => asRecord(entry)).filter(Boolean);
    }
    if (Array.isArray(record.messages)) {
        return record.messages.map((entry) => asRecord(entry)).filter(Boolean);
    }
    if (Array.isArray(record.data)) {
        return record.data.map((entry) => asRecord(entry)).filter(Boolean);
    }
    return [];
}
function findConversationMessage(conversation, targetMessageId) {
    const candidates = [
        ...extractMessageCandidates(conversation?.messages),
        ...extractMessageCandidates(conversation?.payload),
        ...extractMessageCandidates(conversation?.data),
        ...extractMessageCandidates(conversation)
    ];
    return candidates.find((entry) => Number(entry?.id) === targetMessageId) || null;
}
async function loadDeliverySnapshot(record) {
    const providerResp = asRecord(record.providerResp);
    const response = asRecord(providerResp?.response);
    const conversationId = Number(response?.conversation_id);
    const providerMessageId = Number(response?.id);
    if (!Number.isFinite(conversationId) || !Number.isFinite(providerMessageId)) {
        return { state: "unknown", providerStatus: null, providerError: "chatwoot_message_ids_missing", rawMessage: null };
    }
    const cfg = await (0, runtimeConfig_1.getChatwootConfig)();
    if (!cfg.configured) {
        return { state: "unknown", providerStatus: null, providerError: "chatwoot_not_configured", rawMessage: null };
    }
    const client = new client_2.ChatwootClient({
        baseUrl: cfg.baseUrl,
        accountId: cfg.accountId,
        apiAccessToken: cfg.apiAccessToken,
        inboxId: cfg.inboxId
    });
    const conversation = await client.getConversationDetails(conversationId);
    const messageList = await client.listConversationMessages(conversationId).catch(() => null);
    const rawMessage = findConversationMessage(asRecord(messageList?.raw), providerMessageId) ||
        findConversationMessage(asRecord(conversation.raw), providerMessageId);
    let delivery = resolveDeliveryState(rawMessage);
    const providerError = resolveProviderError(rawMessage, providerResp);
    if (providerError && rawMessage && delivery.state === "unknown") {
        delivery = { state: "failed", providerStatus: delivery.providerStatus || "unknown" };
    }
    return { state: delivery.state, providerStatus: delivery.providerStatus, providerError, rawMessage };
}
async function persistSnapshot(record, snapshot, actor) {
    const providerResp = asRecord(record.providerResp) || {};
    const nextProviderResp = {
        ...providerResp,
        delivery: {
            state: snapshot.state,
            providerStatus: snapshot.providerStatus,
            providerError: snapshot.providerError,
            checkedAt: new Date().toISOString(),
            rawMessage: snapshot.rawMessage
        }
    };
    if (snapshot.state === "failed") {
        const errorMessage = snapshot.providerError || snapshot.providerStatus || "chatwoot_delivery_failed";
        await prisma_1.prisma.chatwootMessage.update({
            where: { id: record.id },
            data: {
                status: client_1.MessageStatus.FAILED,
                errorMessage,
                providerResp: nextProviderResp
            }
        });
        await (0, systemLog_1.systemLog)(client_1.LogLevel.WARN, "chatwoot.send", "Entrega fallida reportada por Chatwoot", {
            actor,
            chatwootMessageId: record.id,
            customerId: record.customerId,
            providerStatus: snapshot.providerStatus,
            providerError: snapshot.providerError
        }).catch((err) => {
            logger_1.logger.warn({ err, chatwootMessageId: record.id }, "chatwoot.delivery: failed to write failure log");
        });
        return;
    }
    if (snapshot.state === "delivered" || snapshot.state === "submitted") {
        await prisma_1.prisma.chatwootMessage.update({
            where: { id: record.id },
            data: {
                status: client_1.MessageStatus.SENT,
                errorMessage: snapshot.providerError || null,
                sentAt: record.sentAt ?? record.createdAt ?? new Date(),
                providerResp: nextProviderResp
            }
        });
        return;
    }
    await prisma_1.prisma.chatwootMessage.update({
        where: { id: record.id },
        data: {
            status: client_1.MessageStatus.PENDING,
            errorMessage: snapshot.providerError || "chatwoot_delivery_unconfirmed",
            providerResp: nextProviderResp
        }
    });
}
async function reconcileChatwootMessageDelivery(args) {
    const attempts = Number.isFinite(args.attempts) ? Math.max(1, Math.trunc(args.attempts || 1)) : 1;
    const waitMs = Number.isFinite(args.waitMs) ? Math.max(0, Math.trunc(args.waitMs || 0)) : 0;
    const record = await prisma_1.prisma.chatwootMessage.findUnique({
        where: { id: args.chatwootMessageId },
        select: { id: true, customerId: true, providerResp: true, status: true, errorMessage: true, sentAt: true, createdAt: true }
    });
    if (!record)
        return { ok: false, reason: "message_not_found" };
    let lastSnapshot = null;
    let lastError = null;
    for (let index = 0; index < attempts; index++) {
        try {
            lastSnapshot = await loadDeliverySnapshot(record);
            if (lastSnapshot.state === "failed" || lastSnapshot.state === "delivered") {
                await persistSnapshot(record, lastSnapshot, args.actor);
                return {
                    ok: true,
                    state: lastSnapshot.state,
                    providerStatus: lastSnapshot.providerStatus,
                    providerError: lastSnapshot.providerError
                };
            }
        }
        catch (err) {
            lastError = err?.message ? String(err.message) : "chatwoot_delivery_lookup_failed";
        }
        if (index < attempts - 1 && waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
    if (lastSnapshot) {
        await persistSnapshot(record, lastSnapshot, args.actor);
        return {
            ok: true,
            state: lastSnapshot.state,
            providerStatus: lastSnapshot.providerStatus,
            providerError: lastSnapshot.providerError
        };
    }
    return { ok: false, reason: lastError || "chatwoot_delivery_lookup_failed" };
}
async function reconcileRecentChatwootDeliveries(args) {
    const windowMinutes = Number.isFinite(args?.windowMinutes) ? Math.max(1, Math.trunc(args?.windowMinutes || 15)) : 15;
    const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.trunc(args?.limit || 50)) : 50;
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const messages = await prisma_1.prisma.chatwootMessage.findMany({
        where: {
            status: { in: [client_1.MessageStatus.SENT, client_1.MessageStatus.PENDING] },
            createdAt: { gte: since },
            providerResp: { not: client_1.Prisma.JsonNull }
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, customerId: true, providerResp: true, status: true, errorMessage: true, sentAt: true, createdAt: true }
    });
    let checked = 0;
    let failed = 0;
    for (const message of messages) {
        const result = await reconcileChatwootMessageDelivery({
            chatwootMessageId: message.id,
            actor: "job:chatwootDeliveryReconcile",
            attempts: 1
        }).catch((err) => ({ ok: false, reason: err?.message ? String(err.message) : "unknown_error" }));
        checked++;
        if (result.ok && result.state === "failed")
            failed++;
    }
    return { checked, failed };
}
