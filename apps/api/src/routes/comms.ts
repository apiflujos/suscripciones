import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { computeSmartListRecipients, SmartListRule } from "../services/smartList";
import { getSystemSmartList, getSystemSmartLists } from "../services/systemSmartLists";
import { CHATWOOT_CUSTOM_ATTR_DEFS, ensureChatwootCustomAttributes, syncChatwootAttributesForCustomer } from "../services/chatwootSync";
import { syncSmartListById } from "../services/smartListSync";
import { ChatwootClient } from "../providers/chatwoot/client";
import { getChatwootConfig } from "../services/runtimeConfig";
import { RetryJobType } from "@prisma/client";
import { getEffectiveTenantId } from "../services/tenantContext";

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

function matchesTenant(customer: any, tenantId: string) {
  if (!tenantId) return true;
  if (String(customer?.tenantId || "") === tenantId) return true;
  const links = Array.isArray(customer?.tenantLinks) ? customer.tenantLinks : [];
  return links.some((link: any) => String(link?.tenantId || "") === tenantId);
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
  baseUrl: z.string().url().optional(),
  accountId: z.number().int().positive().optional(),
  inboxId: z.number().int().positive().optional(),
  apiAccessToken: z.string().min(1).optional()
});

commsRouter.get("/smart-lists", async (_req, res) => {
  const req = _req as any;
  const takeRaw = Number(req?.query?.take ?? 100);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const tenantId = await getEffectiveTenantId(req);
  const where = tenantId ? { tenantId } : {};
  const items = await prisma.smartList.findMany({ where, orderBy: { createdAt: "desc" }, take, skip });
  const totalDb = await prisma.smartList.count({ where });
  const systemLists = getSystemSmartLists().map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    category: list.category,
    system: true
  }));
  res.json({ items: [...systemLists, ...items], total: totalDb + systemLists.length });
});

commsRouter.post("/test-connection", async (req, res) => {
  const parsed = testConnectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const stored = await getChatwootConfig();
  const baseUrl = parsed.data.baseUrl || (stored.configured ? stored.baseUrl : "");
  const accountId = parsed.data.accountId || (stored.configured ? stored.accountId : 0);
  const inboxId = parsed.data.inboxId || (stored.configured ? stored.inboxId : 0);
  const apiAccessToken = parsed.data.apiAccessToken || (stored.configured ? stored.apiAccessToken : "");

  if (!baseUrl || !accountId || !inboxId || !apiAccessToken) {
    return res.status(400).json({ error: "connection_not_configured" });
  }

  try {
    const client = new ChatwootClient({
      baseUrl,
      accountId,
      apiAccessToken,
      inboxId
    });

    const account = await client.getAccount();
    const inbox = await client.getInbox(inboxId);
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

  await ensureChatwootCustomAttributes().catch(() => {});

  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  let synced = 0;
  let failed = 0;
  const errors: Array<{ customerId: string; error: string }> = [];
  for (const c of customers) {
    const out = await syncChatwootAttributesForCustomer(c.id).catch((err) => ({ ok: false, reason: err?.message ? String(err.message) : "sync_failed" } as any));
    if (out?.ok) synced += 1;
    else {
      failed += 1;
      if (errors.length < 20) {
        errors.push({ customerId: c.id, error: String(out?.reason || "sync_failed") });
      }
    }
  }
  res.json({ ok: true, synced, failed, limit, errors });
});

commsRouter.post("/bootstrap-attributes", async (_req, res) => {
  let client: ChatwootClient;
  try {
    client = await getChatwootClient();
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "chatwoot_not_configured" });
  }

  const defs = CHATWOOT_CUSTOM_ATTR_DEFS;

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

  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });

  const rules = parseRules(parsed.data.rules);
  const chatwootLabel = slugifyLabel(parsed.data.name);

  const created = await prisma.smartList.create({
    data: {
      tenant: { connect: { id: tenantId } },
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
  const systemList = getSystemSmartList(id);
  if (systemList) {
    return res.json({
      smartList: {
        id: systemList.id,
        name: systemList.name,
        description: systemList.description,
        category: systemList.category,
        system: true,
        rules: systemList.rules
      }
    });
  }
  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return res.status(404).json({ error: "not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId && String(smartList.tenantId) !== tenantId) return res.status(404).json({ error: "not_found" });
  res.json({ smartList });
});

commsRouter.put("/smart-lists/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const parsed = smartListUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const existing = await prisma.smartList.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId && String(existing.tenantId) !== tenantId) return res.status(404).json({ error: "not_found" });

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
  const existing = await prisma.smartList.findUnique({ where: { id } });
  if (!existing) return res.json({ ok: true });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId && String(existing.tenantId) !== tenantId) return res.status(404).json({ error: "not_found" });
  await prisma.smartList.delete({ where: { id } }).catch(() => null);
  res.json({ ok: true });
});

commsRouter.post("/smart-lists/:id/preview", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const tenantId = String((req as any)?.query?.tenantId ?? "").trim();
  const systemList = getSystemSmartList(id);
  if (systemList) {
    const recipients = await computeSmartListRecipients(systemList.rules as any);
    const filtered = tenantId ? recipients.filter((c: any) => matchesTenant(c, tenantId)) : recipients;
    const sample = filtered.slice(0, 20).map((c: any) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone
    }));
    return res.json({ count: filtered.length, sample });
  }

  const smartList = await prisma.smartList.findUnique({ where: { id } });
  if (!smartList) return res.status(404).json({ error: "not_found" });

  const recipients = await computeSmartListRecipients(smartList.rules as any);
  const filtered = tenantId ? recipients.filter((c: any) => matchesTenant(c, tenantId)) : recipients;
  const sample = filtered.slice(0, 20).map((c: any) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone
  }));

  res.json({ count: filtered.length, sample });
});

commsRouter.get("/smart-lists/:id/members", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const takeRaw = Number((req as any)?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number((req as any)?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const activeParam = String((req as any)?.query?.active ?? "").trim();
  const active = activeParam ? activeParam === "1" || activeParam.toLowerCase() === "true" : undefined;
  const tenantId = String((req as any)?.query?.tenantId ?? "").trim();

  const systemList = getSystemSmartList(id);
  if (systemList) {
    if (active === false) return res.json({ items: [] });
    const recipients = await computeSmartListRecipients(systemList.rules as any);
    const filtered = tenantId ? recipients.filter((c: any) => matchesTenant(c, tenantId)) : recipients;
    const slice = filtered.slice(skip, skip + take);
    return res.json({
      items: slice.map((c: any) => ({
        id: `system-${c.id}`,
        active: true,
        lastSeenAt: null,
        customer: {
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone
        }
      })),
      total: filtered.length
    });
  }

  const list = await prisma.smartList.findUnique({ where: { id } });
  if (!list) return res.status(404).json({ error: "not_found" });

  const where: any = { smartListId: id };
  if (active !== undefined) where.active = active;
  if (tenantId) {
    where.customer = {
      OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }]
    };
  }

  const [total, items] = await Promise.all([
    prisma.smartListMember.count({ where }),
    prisma.smartListMember.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      skip,
      include: { customer: { include: { tenantLinks: true } } }
    })
  ]);

  res.json({
    items: items.map((m: any) => ({
      id: m.id,
      active: m.active,
      lastSeenAt: m.lastSeenAt,
      customer: {
        id: m.customer.id,
        name: m.customer.name,
        email: m.customer.email,
        phone: m.customer.phone
      }
    })),
    total
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
  const idsRaw = String(req?.query?.ids ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const where = ids.length ? { id: { in: ids } } : undefined;
  const [items, total] = await Promise.all([
    prisma.campaign.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.campaign.count({ where })
  ]);
  res.json({ items, total });
});

commsRouter.post("/campaigns", async (req, res) => {
  const parsed = campaignCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });

  const created = await prisma.campaign.create({
    data: {
      tenant: { connect: { id: tenantId } },
      name: parsed.data.name,
      ...(parsed.data.smartListId ? { smartList: { connect: { id: parsed.data.smartListId } } } : {}),
      content: parsed.data.content,
      templateParams: parsed.data.templateParams ?? undefined
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
