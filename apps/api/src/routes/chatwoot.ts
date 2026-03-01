import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { ChatwootMessageType, LogLevel, MessageStatus, RetryJobType } from "@prisma/client";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "../services/runtimeConfig";
import { syncChatwootAttributesForCustomer } from "../services/chatwootSync";
import { sendChatwootMessage } from "../jobs/handlers/sendChatwootMessage";
import { getDefaultTenantId, getEffectiveTenantId } from "../services/tenantContext";
import { systemLog } from "../services/systemLog";

export const chatwootRouter = express.Router();

function getClientOrThrow() {
  const cfg = getChatwootConfig();
  return cfg.then((c) => {
    if (!c.configured) throw new Error("chatwoot_not_configured");
    return new ChatwootClient({
      baseUrl: c.baseUrl,
      accountId: c.accountId,
      apiAccessToken: c.apiAccessToken,
      inboxId: c.inboxId
    });
  });
}

const syncSchema = z.object({
  customerId: z.string().min(1)
});

chatwootRouter.post("/contacts/sync", async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const result = await syncChatwootAttributesForCustomer(parsed.data.customerId);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  return res.json({ contactId: result.contactId, sourceId: result.sourceId, skipped: result.skipped ?? false });
});

const createContactSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(4).optional(),
  identifier: z.string().min(1).optional(),
  additionalAttributes: z.record(z.any()).optional(),
  customAttributes: z.record(z.any()).optional()
});

chatwootRouter.post("/contacts", async (req, res) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const created = await client.createContact({
    name: parsed.data.name,
    email: parsed.data.email,
    phoneNumber: parsed.data.phoneNumber
  });
  if (parsed.data.identifier || parsed.data.additionalAttributes || parsed.data.customAttributes) {
    await client.updateContact(created.contactId, {
      identifier: parsed.data.identifier,
      additionalAttributes: parsed.data.additionalAttributes,
      customAttributes: parsed.data.customAttributes
    });
  }
  res.status(201).json({ contactId: created.contactId, sourceId: created.sourceId, raw: created.raw });
});

const updateContactSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(4).optional(),
  identifier: z.string().min(1).optional(),
  additionalAttributes: z.record(z.any()).optional(),
  customAttributes: z.record(z.any()).optional()
});

chatwootRouter.put("/contacts/:contactId", async (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isFinite(contactId)) return res.status(400).json({ error: "invalid_contact_id" });

  const parsed = updateContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const updated = await client.updateContact(contactId, parsed.data);
  res.json({ ok: true, raw: updated.raw });
});

const labelsSchema = z.object({
  labels: z.array(z.string().min(1)).min(1)
});

chatwootRouter.get("/contacts/:contactId/labels", async (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isFinite(contactId)) return res.status(400).json({ error: "invalid_contact_id" });
  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const list = await client.listContactLabels(contactId);
  res.json(list.raw);
});

chatwootRouter.post("/contacts/:contactId/labels", async (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isFinite(contactId)) return res.status(400).json({ error: "invalid_contact_id" });
  const parsed = labelsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const out = await client.addContactLabels(contactId, parsed.data.labels);
  res.json(out.raw);
});

const conversationCreateSchema = z.object({
  contactId: z.number().int().positive(),
  sourceId: z.string().min(1).optional(),
  message: z.string().min(1).optional()
});

chatwootRouter.post("/conversations", async (req, res) => {
  const parsed = conversationCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  try {
    const created = await client.createConversation(parsed.data);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(502).json({ error: "chatwoot_create_conversation_failed", details: err?.message || "unknown_error" });
  }
});

const messageSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  customerId: z.string().min(1).optional(),
  content: z.string().min(1),
  templateParams: z.any().optional(),
  attachmentUrl: z.string().url().optional(),
  inboxId: z.number().int().positive().optional(),
  type: z.nativeEnum(ChatwootMessageType).optional(),
  sendNow: z.boolean().optional()
});

function sanitizeChatwootContent(content: string, attachmentUrl?: string | null) {
  const safe = String(content || "");
  const target = String(attachmentUrl || "").trim();
  const lines = safe.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^imagen\s*:/i.test(trimmed)) return false;
    if (/data:image\//i.test(trimmed)) return false;
    if (target && trimmed.includes(target)) return false;
    return true;
  });
  const normalized = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized || safe.trim();
}

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

chatwootRouter.post("/messages", async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const msgType = parsed.data.type || ChatwootMessageType.PAYMENT_LINK;
  const sendNow = parsed.data.sendNow !== false;
  const cleanContent = sanitizeChatwootContent(parsed.data.content, parsed.data.attachmentUrl);
  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  let conversationId = parsed.data.conversationId;
  let customer: { id: string; tenantId: string | null; metadata?: any } | null = null;

  if (!conversationId && parsed.data.customerId) {
    customer = await prisma.customer.findUnique({
      where: { id: parsed.data.customerId },
      select: { id: true, tenantId: true, metadata: true }
    });
    if (!customer) return res.status(404).json({ error: "customer_not_found" });

    const meta: any = (customer.metadata ?? {}) as any;
    const knownContactId = meta?.chatwoot?.contactId;
    const knownSourceId = meta?.chatwoot?.sourceId;

    try {
      if (!knownContactId) {
        const synced = await syncChatwootAttributesForCustomer(customer.id);
        if (!synced.ok) return res.status(400).json({ error: synced.reason });
        conversationId = (await client.createConversation({ contactId: synced.contactId, sourceId: synced.sourceId })).conversationId;
      } else {
        await syncChatwootAttributesForCustomer(customer.id).catch(() => {});
        conversationId = (await client.createConversation({ contactId: knownContactId, sourceId: knownSourceId })).conversationId;
      }
    } catch (err: any) {
      return res.status(502).json({ error: "chatwoot_create_conversation_failed", details: err?.message || "unknown_error" });
    }
  }

  if (!conversationId) return res.status(400).json({ error: "missing_conversation_or_customer" });

  // If we have a customer, create message and send immediately (default).
  if (parsed.data.customerId) {
    const existing = await prisma.chatwootMessage.findFirst({
      where: {
        customerId: parsed.data.customerId,
        type: msgType,
        content: cleanContent,
        status: { in: [MessageStatus.PENDING, MessageStatus.SENT] },
        createdAt: { gt: new Date(Date.now() - DEDUPE_WINDOW_MS) }
      },
      select: { id: true }
    });
    if (existing) {
      await systemLog(LogLevel.WARN, "chatwoot.send", "Mensaje duplicado; omitido", {
        chatwootMessageId: existing.id,
        customerId: parsed.data.customerId,
        type: msgType
      }).catch(() => {});
      return res.json({ ok: true, duplicated: true, messageId: existing.id });
    }

    const providerResp: any = {};
    if (parsed.data.templateParams) providerResp.template_params = parsed.data.templateParams;
    if (parsed.data.attachmentUrl) providerResp.attachment = { url: parsed.data.attachmentUrl };
    if (Number.isFinite(parsed.data.inboxId)) providerResp.inboxId = parsed.data.inboxId;
    const resolvedTenantId =
      customer?.tenantId ?? (await getEffectiveTenantId(req)) ?? (await getDefaultTenantId());
    if (!resolvedTenantId) return res.status(400).json({ error: "tenant_required" });
    const created = await prisma.chatwootMessage.create({
      data: {
        tenantId: resolvedTenantId,
        customerId: parsed.data.customerId,
        type: msgType,
        status: MessageStatus.PENDING,
        content: cleanContent,
        providerResp: Object.keys(providerResp).length ? (providerResp as any) : null
      }
    });
    if (sendNow) {
      try {
        await sendChatwootMessage(created.id);
        return res.json({ ok: true, sent: true, messageId: created.id });
      } catch (err: any) {
        return res.status(502).json({ ok: false, error: "centralcom_send_failed", messageId: created.id, details: String(err?.message || err) });
      }
    }

    await prisma.retryJob.create({
      data: {
        type: RetryJobType.SEND_CHATWOOT_MESSAGE,
        payload: { chatwootMessageId: created.id }
      }
    });
    return res.json({ ok: true, queued: true, messageId: created.id });
  }

  const out = parsed.data.templateParams
    ? await client.sendTemplate(conversationId, { content: cleanContent, templateParams: parsed.data.templateParams })
    : await client.sendMessage(conversationId, cleanContent);
  return res.json(out.raw);
});

chatwootRouter.get("/conversations/:conversationId/labels", async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  if (!Number.isFinite(conversationId)) return res.status(400).json({ error: "invalid_conversation_id" });
  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const list = await client.listConversationLabels(conversationId);
  res.json(list.raw);
});

chatwootRouter.post("/conversations/:conversationId/labels", async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  if (!Number.isFinite(conversationId)) return res.status(400).json({ error: "invalid_conversation_id" });
  const parsed = labelsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const out = await client.addConversationLabels(conversationId, parsed.data.labels);
  res.json(out.raw);
});

const convCustomAttrsSchema = z.object({
  customAttributes: z.record(z.any())
});

chatwootRouter.get("/inboxes", async (req, res) => {
  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;
  try {
    const out = await client.listInboxes();
    const items = Array.isArray(out.raw?.payload) ? out.raw.payload : Array.isArray(out.raw) ? out.raw : [];
    const normalized = items.map((item: any) => ({
      id: Number(item?.id || item?.inbox_id || item?.inboxId),
      name: String(item?.name || item?.channel_name || item?.channel?.name || ""),
      channelType: String(item?.channel_type || item?.channelType || item?.channel?.channel_type || ""),
      medium: String(item?.medium || item?.channel?.medium || ""),
      provider: String(item?.provider || item?.channel?.provider || "")
    })).filter((item: any) => Number.isFinite(item.id));
    res.json({ items: normalized });
  } catch (err: any) {
    res.status(502).json({ error: "chatwoot_list_inboxes_failed", details: err?.message || "unknown_error" });
  }
});

chatwootRouter.post("/conversations/:conversationId/custom-attributes", async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  if (!Number.isFinite(conversationId)) return res.status(400).json({ error: "invalid_conversation_id" });
  const parsed = convCustomAttrsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const out = await client.updateConversationCustomAttributes(conversationId, parsed.data.customAttributes);
  res.json(out.raw);
});

chatwootRouter.get("/contacts/:contactId/conversations", async (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isFinite(contactId)) return res.status(400).json({ error: "invalid_contact_id" });
  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  try {
    const out = await client.listContactConversations(contactId);
    res.json(out.raw ?? { payload: [] });
  } catch (err: any) {
    res.status(502).json({
      error: "chatwoot_list_contact_conversations_failed",
      details: err?.message || "unknown_error"
    });
  }
});

const listCustomAttrsSchema = z.object({
  model: z.enum(["contact", "conversation"])
});

chatwootRouter.get("/custom-attributes", async (req, res) => {
  const parsed = listCustomAttrsSchema.safeParse({ model: String((req as any)?.query?.model || "").trim() });
  if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const out = await client.listCustomAttributes(parsed.data.model);
  res.json(out.raw);
});

const createCustomAttrSchema = z.object({
  displayName: z.string().min(1),
  key: z.string().min(1),
  displayType: z.union([z.enum(["text", "number", "currency", "boolean", "url", "date", "list", "percent", "checkbox"]), z.number().int()]),
  model: z.union([z.enum(["contact", "conversation"]), z.number().int()]),
  values: z.array(z.string().min(1)).optional(),
  description: z.string().min(1).optional(),
  regexPattern: z.string().min(1).optional(),
  regexCue: z.string().min(1).optional()
});

chatwootRouter.post("/custom-attributes", async (req, res) => {
  const parsed = createCustomAttrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  const out = await client.createCustomAttribute(parsed.data);
  res.status(201).json(out.raw);
});
