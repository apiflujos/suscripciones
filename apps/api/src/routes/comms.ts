import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { computeSmartListRecipients, SmartListRule } from "../services/smartList";
import { syncChatwootAttributesForCustomer } from "../services/chatwootSync";
import { syncSmartListById } from "../services/smartListSync";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "../services/runtimeConfig";
import { RetryJobType } from "@prisma/client";

export const commsRouter = express.Router();

function slugifyLabel(name: string) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `list_${base || "unnamed"}`;
}

function parseRules(input: any): SmartListRule {
  if (!input || typeof input !== "object") {
    return { op: "and", rules: [] };
  }
  return input as SmartListRule;
}

async function getChatwootClient() {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) throw new Error("chatwoot_not_configured");
  return new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
}

const smartListCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  rules: z.any()
});

const testConnectionSchema = z.object({
  baseUrl: z.string().url(),
  accountId: z.number().int().positive(),
  inboxId: z.number().int().positive(),
  apiAccessToken: z.string().min(1)
});

commsRouter.get("/smart-lists", async (_req, res) => {
  const req = _req as any;
  const takeRaw = Number(req?.query?.take ?? 100);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const items = await prisma.smartList.findMany({ orderBy: { createdAt: "desc" }, take, skip });
  res.json({ items });
});

commsRouter.post("/test-connection", async (req, res) => {
  const parsed = testConnectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    const client = new ChatwootClient({
      baseUrl: parsed.data.baseUrl,
      accountId: parsed.data.accountId,
      apiAccessToken: parsed.data.apiAccessToken,
      inboxId: parsed.data.inboxId
    });

    const account = await client.getAccount();
    const inbox = await client.getInbox(parsed.data.inboxId);
    return res.json({
      ok: true,
      account: account.raw?.payload || account.raw || null,
      inbox: inbox.raw?.payload || inbox.raw || null
    });
  } catch (err: any) {
    return res.status(400).json({ error: "connection_failed", message: String(err?.message || err) });
  }
});

commsRouter.post("/sync-attributes", async (req, res) => {
  const limitRaw = Number((req as any)?.query?.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 2000) : 200;

  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  let synced = 0;
  for (const c of customers) {
    const out = await syncChatwootAttributesForCustomer(c.id).catch(() => null);
    if (out?.ok) synced += 1;
  }
  res.json({ ok: true, synced, limit });
});

commsRouter.post("/bootstrap-attributes", async (_req, res) => {
  let client: ChatwootClient;
  try {
    client = await getChatwootClient();
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
  }

  const defs: Array<{
    key: string;
    displayName: string;
    displayType: "text" | "number" | "currency" | "boolean" | "url" | "date" | "list" | "percent" | "checkbox";
    values?: string[];
  }> = [
    { key: "subscription_status", displayName: "Subscription Status", displayType: "list", values: ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"] },
    { key: "plan_name", displayName: "Plan Name", displayType: "text" },
    { key: "plan_price", displayName: "Plan Price (cents)", displayType: "number" },
    { key: "next_billing_date", displayName: "Next Billing Date", displayType: "date" },
    { key: "last_payment_status", displayName: "Last Payment Status", displayType: "list", values: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"] },
    { key: "last_payment_date", displayName: "Last Payment Date", displayType: "date" },
    { key: "days_past_due", displayName: "Days Past Due", displayType: "number" },
    { key: "in_mora", displayName: "In Mora", displayType: "boolean" }
  ];

  const results: Array<{ key: string; ok: boolean; error?: string }> = [];
  for (const def of defs) {
    try {
      await client.createCustomAttribute({ ...def, model: "contact" });
      results.push({ key: def.key, ok: true });
    } catch (err: any) {
      results.push({ key: def.key, ok: false, error: err?.message ? String(err.message) : "failed" });
    }
  }

  res.json({ ok: true, results });
});

commsRouter.post("/smart-lists", async (req, res) => {
  const parsed = smartListCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const rules = parseRules(parsed.data.rules);
  const chatwootLabel = slugifyLabel(parsed.data.name);

  const created = await prisma.smartList.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      enabled: parsed.data.enabled ?? true,
      rules: rules as any,
      chatwootLabel
    }
  });
  res.status(201).json({ smartList: created });
});

const smartListUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  rules: z.any().optional()
});

commsRouter.get("/smart-lists/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return res.status(404).json({ error: "not_found" });
  res.json({ smartList });
});

commsRouter.put("/smart-lists/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const parsed = smartListUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const existing = await prisma.smartList.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "not_found" });

  const rules = parsed.data.rules != null ? parseRules(parsed.data.rules) : undefined;
  const nextLabel = parsed.data.name ? slugifyLabel(parsed.data.name) : undefined;

  const updated = await prisma.smartList.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      enabled: parsed.data.enabled,
      rules: rules ? (rules as any) : undefined,
      chatwootLabel: nextLabel
    }
  });
  res.json({ smartList: updated });
});

commsRouter.delete("/smart-lists/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  await prisma.smartList.delete({ where: { id } }).catch(() => null);
  res.json({ ok: true });
});

commsRouter.post("/smart-lists/:id/preview", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return res.status(404).json({ error: "not_found" });

  const recipients = await computeSmartListRecipients(smartList.rules as any);
  const sample = recipients.slice(0, 20).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone
  }));

  res.json({ count: recipients.length, sample });
});

commsRouter.get("/smart-lists/:id/members", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const takeRaw = Number((req as any)?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number((req as any)?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const activeParam = String((req as any)?.query?.active ?? "").trim();
  const active = activeParam ? activeParam === "1" || activeParam.toLowerCase() === "true" : undefined;

  const list = await prisma.smartList.findUnique({ where: { id } });
  if (!list) return res.status(404).json({ error: "not_found" });

  const where: any = { smartListId: id };
  if (active !== undefined) where.active = active;

  const items = await prisma.smartListMember.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take,
    skip,
    include: { customer: true }
  });

  res.json({
    items: items.map((m) => ({
      id: m.id,
      active: m.active,
      lastSeenAt: m.lastSeenAt,
      customer: {
        id: m.customer.id,
        name: m.customer.name,
        email: m.customer.email,
        phone: m.customer.phone
      }
    }))
  });
});

commsRouter.post("/smart-lists/:id/sync", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return res.status(404).json({ error: "not_found" });

  const out = await syncSmartListById(id).catch((err: any) => {
    res.status(400).json({ error: err?.message || "sync_failed" });
    return null;
  });
  if (!out) return;
  res.json({ ok: true, added: out.added, removed: out.removed, label: smartList.chatwootLabel });
});

const campaignCreateSchema = z.object({
  name: z.string().min(1),
  smartListId: z.string().min(1).optional(),
  content: z.string().min(1),
  templateParams: z.record(z.any()).optional()
});

commsRouter.get("/campaigns", async (_req, res) => {
  const req = _req as any;
  const takeRaw = Number(req?.query?.take ?? 100);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const items = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take, skip });
  res.json({ items });
});

commsRouter.post("/campaigns", async (req, res) => {
  const parsed = campaignCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const created = await prisma.campaign.create({
    data: {
      name: parsed.data.name,
      smartListId: parsed.data.smartListId,
      content: parsed.data.content,
      templateParams: parsed.data.templateParams ?? null
    }
  });
  res.status(201).json({ campaign: created });
});

commsRouter.get("/campaigns/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return res.status(404).json({ error: "not_found" });
  res.json({ campaign });
});

const campaignUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  templateParams: z.record(z.any()).optional(),
  smartListId: z.string().min(1).nullable().optional(),
  status: z.enum(["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "FAILED"]).optional()
});

commsRouter.put("/campaigns/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const parsed = campaignUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const updated = await prisma.campaign.update({
    where: { id },
    data: {
      name: parsed.data.name,
      content: parsed.data.content,
      templateParams: parsed.data.templateParams ?? undefined,
      smartListId: parsed.data.smartListId === null ? null : parsed.data.smartListId,
      status: parsed.data.status as any
    }
  });
  res.json({ campaign: updated });
});

commsRouter.post("/campaigns/:id/run", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return res.status(404).json({ error: "not_found" });

  await prisma.campaign.update({
    where: { id },
    data: { status: "RUNNING", startedAt: campaign.startedAt ?? new Date(), lastError: null }
  });

  await prisma.retryJob.create({
    data: {
      type: RetryJobType.SEND_CAMPAIGN,
      payload: { campaignId: id }
    }
  });

  res.json({ ok: true });
});

commsRouter.get("/campaigns/:id/sends", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const takeRaw = Number((req as any)?.query?.take ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 200;
  const skipRaw = Number((req as any)?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const items = await prisma.campaignSend.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "desc" },
    take,
    skip
  });
  res.json({ items });
});
