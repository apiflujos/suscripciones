import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "../services/runtimeConfig";
import { ensureChatwootContactForCustomer } from "../services/chatwootSync";

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

  const result = await ensureChatwootContactForCustomer(parsed.data.customerId);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  return res.json({ contactId: result.contactId, sourceId: result.sourceId });
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

  const created = await client.createConversation(parsed.data);
  res.status(201).json(created);
});

const messageSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  customerId: z.string().min(1).optional(),
  content: z.string().min(1),
  templateParams: z.any().optional()
});

chatwootRouter.post("/messages", async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const client = await getClientOrThrow().catch((err) => {
    res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
    return null;
  });
  if (!client) return;

  let conversationId = parsed.data.conversationId;

  if (!conversationId && parsed.data.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
    if (!customer) return res.status(404).json({ error: "customer_not_found" });

    const meta: any = (customer.metadata ?? {}) as any;
    const knownContactId = meta?.chatwoot?.contactId;
    const knownSourceId = meta?.chatwoot?.sourceId;

    if (!knownContactId) {
      const synced = await ensureChatwootContactForCustomer(customer.id);
      if (!synced.ok) return res.status(400).json({ error: synced.reason });
      conversationId = (await client.createConversation({ contactId: synced.contactId, sourceId: synced.sourceId })).conversationId;
    } else {
      conversationId = (await client.createConversation({ contactId: knownContactId, sourceId: knownSourceId })).conversationId;
    }
  }

  if (!conversationId) return res.status(400).json({ error: "missing_conversation_or_customer" });

  const out = parsed.data.templateParams
    ? await client.sendTemplate(conversationId, { content: parsed.data.content, templateParams: parsed.data.templateParams })
    : await client.sendMessage(conversationId, parsed.data.content);
  res.json(out.raw);
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
