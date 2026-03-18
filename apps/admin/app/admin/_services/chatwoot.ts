import "server-only";

import { ChatwootMessageType, MessageStatus, RetryJobType } from "@prisma/client";
import { prisma } from "@suscripciones/database";
import { getClientOrThrow, sanitizeChatwootContent, DEDUPE_WINDOW_MS } from "../chatwoot/_lib";
import { syncChatwootAttributesForCustomer } from "@suscripciones/core/services/chatwootSync";
import { sendChatwootMessage } from "@suscripciones/core/jobs/handlers/sendChatwootMessage";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";

export async function sendChatwootMessageForCustomer(args: {
  customerId: string;
  content: string;
  actor?: string | null;
  templateParams?: any;
  attachmentUrl?: string | null;
  inboxId?: number | null;
  type?: ChatwootMessageType;
}) {
  const customerId = String(args.customerId || "").trim();
  const content = String(args.content || "").trim();
  if (!customerId || !content) {
    return { ok: false, status: 400, error: "invalid_payload" as const };
  }

  const cleanContent = sanitizeChatwootContent(content, args.attachmentUrl || undefined);
  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return { ok: false, status: 400, error: (client as any).error as string };

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, tenantId: true, metadata: true }
  });
  if (!customer) return { ok: false, status: 404, error: "customer_not_found" as const };

  const msgType = args.type || ChatwootMessageType.PAYMENT_LINK;
  const existing = await prisma.chatwootMessage.findFirst({
    where: {
      customerId,
      type: msgType,
      content: cleanContent,
      status: { in: [MessageStatus.PENDING, MessageStatus.SENT] },
      createdAt: { gt: new Date(Date.now() - DEDUPE_WINDOW_MS) }
    },
    select: { id: true }
  });
  if (existing) return { ok: true, duplicated: true, messageId: existing.id };

  const meta: any = (customer.metadata ?? {}) as any;
  const knownContactId = meta?.chatwoot?.contactId;
  const knownSourceId = meta?.chatwoot?.sourceId;

  let conversationId: number | undefined;
  try {
    if (!knownContactId) {
      const synced = await syncChatwootAttributesForCustomer(customer.id);
      if (!synced.ok) return { ok: false, status: 400, error: synced.reason || "sync_failed" };
      conversationId = (await (client as any).createConversation({ contactId: synced.contactId, sourceId: synced.sourceId })).conversationId;
    } else {
      await syncChatwootAttributesForCustomer(customer.id).catch(() => {});
      conversationId = (await (client as any).createConversation({ contactId: knownContactId, sourceId: knownSourceId })).conversationId;
    }
  } catch (err: any) {
    return { ok: false, status: 502, error: "chatwoot_create_conversation_failed", details: err?.message || "unknown_error" };
  }

  if (!conversationId) return { ok: false, status: 400, error: "missing_conversation" as const };

  const resolvedTenantId = customer.tenantId || (await getDefaultTenantId());
  if (!resolvedTenantId) return { ok: false, status: 400, error: "tenant_required" as const };

  const providerResp: any = {};
  if (args.templateParams) providerResp.template_params = args.templateParams;
  if (args.attachmentUrl) providerResp.attachment = { url: args.attachmentUrl };
  if (Number.isFinite(args.inboxId)) providerResp.inboxId = args.inboxId;

  const created = await prisma.chatwootMessage.create({
    data: {
      tenantId: resolvedTenantId,
      customerId,
      type: msgType,
      status: MessageStatus.PENDING,
      content: cleanContent,
      actor: args.actor || "Sistema",
      providerResp: Object.keys(providerResp).length ? (providerResp as any) : null
    }
  });

  try {
    await sendChatwootMessage(created.id);
    return { ok: true, sent: true, messageId: created.id };
  } catch (err: any) {
    await prisma.retryJob.create({
      data: {
        type: RetryJobType.SEND_CHATWOOT_MESSAGE,
        payload: { chatwootMessageId: created.id }
      }
    });
    return { ok: false, status: 502, error: "centralcom_send_failed", messageId: created.id, details: String(err?.message || err) };
  }
}

export async function listChatwootContactConversations(contactId: number) {
  const contactIdNum = Number(contactId);
  if (!Number.isFinite(contactIdNum)) return { ok: false, status: 400, error: "invalid_contact_id" as const };
  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return { ok: false, status: 400, error: (client as any).error as string };

  try {
    const out = await (client as any).listContactConversations(contactIdNum);
    return { ok: true, payload: out.raw ?? { payload: [] } };
  } catch (err: any) {
    return { ok: false, status: 502, error: "chatwoot_list_contact_conversations_failed", details: err?.message || "unknown_error" };
  }
}

export async function listChatwootInboxes() {
  const client = await getClientOrThrow().catch((err) => ({ error: err?.message || "chatwoot_not_configured" } as any));
  if ((client as any)?.error) return { ok: false, status: 400, error: (client as any).error as string };

  try {
    const out = await (client as any).listInboxes();
    const items = Array.isArray(out.raw?.payload) ? out.raw.payload : Array.isArray(out.raw) ? out.raw : [];
    const normalized = items
      .map((item: any) => ({
        id: Number(item?.id || item?.inbox_id || item?.inboxId),
        name: String(item?.name || item?.channel_name || item?.channel?.name || ""),
        channelType: String(item?.channel_type || item?.channelType || item?.channel?.channel_type || ""),
        medium: String(item?.medium || item?.channel?.medium || ""),
        provider: String(item?.provider || item?.channel?.provider || "")
      }))
      .filter((item: any) => Number.isFinite(item.id));
    return { ok: true, items: normalized };
  } catch (err: any) {
    return { ok: false, status: 502, error: "chatwoot_list_inboxes_failed", details: err?.message || "unknown_error" };
  }
}
