import { LogLevel, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "./runtimeConfig";
import { systemLog } from "./systemLog";
import { logger } from "../lib/logger";

type ChatwootMessageRecord = {
  id: string;
  customerId: string;
  providerResp: Prisma.JsonValue | null;
  status: MessageStatus;
  errorMessage: string | null;
  sentAt?: Date | null;
  createdAt?: Date | null;
};

type DeliverySnapshot = {
  state: "failed" | "delivered" | "submitted" | "unknown";
  providerStatus: string | null;
  providerError: string | null;
  rawMessage: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function extractErrorStrings(value: unknown, out: string[]) {
  if (!value) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractErrorStrings(item, out);
    return;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      extractErrorStrings(entry, out);
    }
  }
}

function inferMissingTemplateParamFromProcessedParams(processedParams: Record<string, unknown> | null) {
  if (!processedParams) return null;
  const sections: Array<["body" | "header" | "buttons", unknown]> = [
    ["body", processedParams.body],
    ["header", processedParams.header],
    ["buttons", processedParams.buttons]
  ];
  for (const [section, entries] of sections) {
    if (Array.isArray(entries)) {
      const missingIndex = entries.findIndex((entry: unknown) => {
        const rec = asRecord(entry);
        const value = stringifyValue(rec?.parameter ?? rec?.value ?? rec?.text ?? entry);
        return !value;
      });
      if (missingIndex >= 0) return `${section}:${missingIndex + 1}`;
      continue;
    }
    const record = asRecord(entries);
    if (!record) continue;
    const keys = Object.keys(record).sort((a, b) => Number(a) - Number(b));
    const missingKey = keys.find((key) => !stringifyValue(record[key]));
    if (missingKey) {
      return `${section}:${missingKey}`;
    }
  }
  return null;
}

function resolveProviderError(rawMessage: Record<string, unknown> | null, providerResp: Record<string, unknown> | null) {
  const candidates: string[] = [];
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
  if (normalized.length) return normalized.join(" | ");
  const processedParams = asRecord(asRecord(providerResp?.template_params)?.processed_params);
  const missing = inferMissingTemplateParamFromProcessedParams(processedParams);
  return missing ? `missing_template_param_inferred:${missing}` : null;
}

function resolveDeliveryState(rawMessage: Record<string, unknown> | null) {
  const rawStatus = stringifyValue(rawMessage?.status).toLowerCase();
  if (!rawStatus) return { state: "unknown" as const, providerStatus: null };
  if (["failed", "error"].includes(rawStatus)) return { state: "failed" as const, providerStatus: rawStatus };
  if (["delivered", "read"].includes(rawStatus)) return { state: "delivered" as const, providerStatus: rawStatus };
  if (["sent", "pending"].includes(rawStatus)) return { state: "submitted" as const, providerStatus: rawStatus };
  return { state: "unknown" as const, providerStatus: rawStatus };
}

function findConversationMessage(conversation: Record<string, unknown> | null, targetMessageId: number) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return (
    messages.find((entry: unknown) => Number(asRecord(entry)?.id) === targetMessageId) as Record<string, unknown> | undefined
  ) || null;
}

async function loadDeliverySnapshot(record: ChatwootMessageRecord): Promise<DeliverySnapshot> {
  const providerResp = asRecord(record.providerResp);
  const response = asRecord(providerResp?.response);
  const conversationId = Number(response?.conversation_id);
  const providerMessageId = Number(response?.id);
  if (!Number.isFinite(conversationId) || !Number.isFinite(providerMessageId)) {
    return { state: "unknown", providerStatus: null, providerError: "chatwoot_message_ids_missing", rawMessage: null };
  }

  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    return { state: "unknown", providerStatus: null, providerError: "chatwoot_not_configured", rawMessage: null };
  }
  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
  const conversation = await client.getConversationDetails(conversationId);
  const rawMessage = findConversationMessage(asRecord(conversation.raw), providerMessageId);
  const delivery = resolveDeliveryState(rawMessage);
  const providerError = resolveProviderError(rawMessage, providerResp);
  return { state: delivery.state, providerStatus: delivery.providerStatus, providerError, rawMessage };
}

async function persistSnapshot(record: ChatwootMessageRecord, snapshot: DeliverySnapshot, actor: string) {
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
    await prisma.chatwootMessage.update({
      where: { id: record.id },
      data: {
        status: MessageStatus.FAILED,
        errorMessage,
        providerResp: nextProviderResp as Prisma.InputJsonValue
      }
    });
    await systemLog(LogLevel.WARN, "chatwoot.send", "Entrega fallida reportada por Chatwoot", {
      actor,
      chatwootMessageId: record.id,
      customerId: record.customerId,
      providerStatus: snapshot.providerStatus,
      providerError: snapshot.providerError
    }).catch((err) => {
      logger.warn({ err, chatwootMessageId: record.id }, "chatwoot.delivery: failed to write failure log");
    });
    return;
  }

  if (snapshot.state === "delivered" || snapshot.state === "submitted" || snapshot.state === "unknown") {
    await prisma.chatwootMessage.update({
      where: { id: record.id },
      data: {
        status: MessageStatus.SENT,
        errorMessage: snapshot.providerError || null,
        sentAt: record.sentAt ?? record.createdAt ?? new Date(),
        providerResp: nextProviderResp as Prisma.InputJsonValue
      }
    });
  }
}

export async function reconcileChatwootMessageDelivery(args: {
  chatwootMessageId: string;
  actor: string;
  attempts?: number;
  waitMs?: number;
}) {
  const attempts = Number.isFinite(args.attempts) ? Math.max(1, Math.trunc(args.attempts || 1)) : 1;
  const waitMs = Number.isFinite(args.waitMs) ? Math.max(0, Math.trunc(args.waitMs || 0)) : 0;
  const record = await prisma.chatwootMessage.findUnique({
    where: { id: args.chatwootMessageId },
    select: { id: true, customerId: true, providerResp: true, status: true, errorMessage: true, sentAt: true, createdAt: true }
  });
  if (!record) return { ok: false as const, reason: "message_not_found" as const };

  let lastSnapshot: DeliverySnapshot | null = null;
  let lastError: string | null = null;
  for (let index = 0; index < attempts; index++) {
    try {
      lastSnapshot = await loadDeliverySnapshot(record);
      if (lastSnapshot.state === "failed" || lastSnapshot.state === "delivered") {
        await persistSnapshot(record, lastSnapshot, args.actor);
        return {
          ok: true as const,
          state: lastSnapshot.state,
          providerStatus: lastSnapshot.providerStatus,
          providerError: lastSnapshot.providerError
        };
      }
    } catch (err: any) {
      lastError = err?.message ? String(err.message) : "chatwoot_delivery_lookup_failed";
    }
    if (index < attempts - 1 && waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  if (lastSnapshot) {
    await persistSnapshot(record, lastSnapshot, args.actor);
    return {
      ok: true as const,
      state: lastSnapshot.state,
      providerStatus: lastSnapshot.providerStatus,
      providerError: lastSnapshot.providerError
    };
  }
  return { ok: false as const, reason: lastError || "chatwoot_delivery_lookup_failed" };
}

export async function reconcileRecentChatwootDeliveries(args?: { windowMinutes?: number; limit?: number }) {
  const windowMinutes = Number.isFinite(args?.windowMinutes) ? Math.max(1, Math.trunc(args?.windowMinutes || 15)) : 15;
  const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.trunc(args?.limit || 50)) : 50;
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const messages = await prisma.chatwootMessage.findMany({
    where: {
      status: { in: [MessageStatus.SENT, MessageStatus.PENDING] },
      createdAt: { gte: since },
      providerResp: { not: Prisma.JsonNull } as any
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
    }).catch((err: any) => ({ ok: false as const, reason: err?.message ? String(err.message) : "unknown_error" }));
    checked++;
    if (result.ok && result.state === "failed") failed++;
  }
  return { checked, failed };
}
