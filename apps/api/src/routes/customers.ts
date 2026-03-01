import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiPublicKey } from "../services/runtimeConfig";
import { syncChatwootAttributesForCustomer } from "../services/chatwootSync";
import { consumeApp } from "../services/superAdminApp";
import { getEffectiveTenantId, getEffectiveTenantIds } from "../services/tenantContext";

const createCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email(),
  phone: z.string().min(6),
  metadata: z.any().optional()
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(6).optional().or(z.literal("")),
  metadata: z.any().optional()
});

const wompiPaymentSourceSchema = z.object({
  type: z.enum(["CARD", "NEQUI", "PSE"]).default("CARD"),
  token: z.string().min(1)
});

export const customersRouter = express.Router();

customersRouter.post("/tokenization-links/:token/consume", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "missing_token" });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) return res.status(404).json({ error: "token_not_found" });

  const meta: any = customer.metadata ?? {};
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  if (usedAt) return res.status(409).json({ error: "token_used" });
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "token_expired" });
  }

  const now = new Date().toISOString();
  const updated = await prisma.$executeRaw`
    UPDATE "Customer"
    SET "metadata" = jsonb_set(COALESCE("metadata",'{}'::jsonb), '{tokenizationLink,usedAt}', to_jsonb(${now}::text), true)
    WHERE "metadata"->'tokenizationLink'->>'token' = ${token}
      AND (("metadata"->'tokenizationLink'->>'usedAt') IS NULL OR ("metadata"->'tokenizationLink'->>'usedAt') = '')
  `;

  if (!updated) return res.status(409).json({ error: "token_used" });
  res.json({ ok: true, customerId: customer.id, usedAt: now });
});

customersRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const tenantId = await getEffectiveTenantId(req);
  const takeRaw = Number(req?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(req?.query?.q ?? "").trim();
  const idsRaw = String(req?.query?.ids ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];

  const where: any = {};
  if (tenantId) {
    where.AND = [
      { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] }
    ];
  }
  if (q) {
    const or: any[] = [];
    const qLower = q.toLowerCase();
    const digits = q.replace(/[^\d]/g, "");
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(q);
    const isEmail = q.includes("@");
    if (isUuid) or.push({ id: q });
    if (isEmail) or.push({ email: { equals: qLower, mode: "insensitive" } });
    or.push({ name: { contains: q, mode: "insensitive" } });
    or.push({ email: { contains: q, mode: "insensitive" } });
    if (digits.length >= 4) {
      or.push({ phone: { contains: digits } });
      or.push({ phone: { contains: q } });
    } else {
      or.push({ phone: { contains: q, mode: "insensitive" } });
    }
    or.push({ metadata: { path: ["identificacion"], string_contains: q } } as any);
    or.push({ metadata: { path: ["identificacionNumero"], string_contains: q } } as any);
    or.push({ metadata: { path: ["identificationNumber"], string_contains: q } } as any);
    or.push({ metadata: { path: ["documentNumber"], string_contains: q } } as any);
    or.push({ metadata: { path: ["document"], string_contains: q } } as any);
    if (!where.AND) where.AND = [];
    where.AND.push({ OR: or });
  }

  if (ids.length) {
    if (!where.AND) where.AND = [];
    where.AND.push({ id: { in: ids } });
  }

  const [items, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.customer.count({ where })
  ]);
  res.json({ items, total });
});

customersRouter.get("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = customer.tenantId === tenantId
      || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
    if (!allowed) return res.status(404).json({ error: "customer_not_found" });
  }
  res.json({ customer });
});

customersRouter.get("/:id/payments", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  const tenantId = await getEffectiveTenantId(req);
  const takeRaw = Number(req.query.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(req.query.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;

  const items = await prisma.payment.findMany({
    where: { customerId, ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: {
      subscription: { include: { plan: true } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  res.json({
    items: items.map((p: any) => ({
      id: p.id,
      amountInCents: p.amountInCents,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      reference: p.reference,
      planId: p.subscription?.planId || null,
      planName: p.subscription?.plan?.name || null,
      lastAttempt: p.attempts?.[0]
        ? {
            status: p.attempts[0].status,
            errorMessage: p.attempts[0].errorMessage,
            provider: p.attempts[0].provider,
            createdAt: p.attempts[0].createdAt
          }
        : null
    }))
  });
});

customersRouter.post("/", async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenantIds = await getEffectiveTenantIds(req);
  if (!tenantIds.length) return res.status(400).json({ error: "tenant_required" });
  const primaryTenantId = tenantIds[0];
  const customer = await prisma.customer.create({ data: { ...(parsed.data as any), tenantId: primaryTenantId } });
  await prisma.customerTenant
    .createMany({ data: tenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
    .catch(() => {});
  await consumeApp("customers_created", { amount: 1, source: "api:customers.create", meta: { customerId: customer.id } });
  await syncChatwootAttributesForCustomer(customer.id).catch(() => {});
  res.status(201).json({ customer });
});

customersRouter.put("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data: any = { ...parsed.data };
  if (data.name === "") data.name = null;
  if (data.email === "") data.email = null;
  if (data.phone === "") data.phone = null;
  if (data.name === undefined) delete data.name;
  if (data.email === undefined) delete data.email;
  if (data.phone === undefined) delete data.phone;

  try {
    const tenantId = await getEffectiveTenantId(req);
    if (tenantId) {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) return res.status(404).json({ error: "customer_not_found" });
      const allowed = existing.tenantId === tenantId
        || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
      if (!allowed) return res.status(404).json({ error: "customer_not_found" });
    }
    const updated = await prisma.customer.update({ where: { id: customerId }, data });
    await syncChatwootAttributesForCustomer(updated.id).catch(() => {});
    res.json({ customer: updated });
  } catch (err: any) {
    if (String(err?.code) === "P2025") return res.status(404).json({ error: "customer_not_found" });
    throw err;
  }
});

customersRouter.delete("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  try {
    const tenantId = await getEffectiveTenantId(req);
    if (tenantId) {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) return res.status(404).json({ error: "customer_not_found" });
      const allowed = existing.tenantId === tenantId
        || (await prisma.customerTenant.count({ where: { customerId, tenantId } })) > 0;
      if (!allowed) return res.status(404).json({ error: "customer_not_found" });
    }
    const [subscriptionsCount, paymentsCount, chatwootCount, smartListCount, campaignCount] = await Promise.all([
      prisma.subscription.count({ where: { customerId } }),
      prisma.payment.count({ where: { customerId } }),
      prisma.chatwootMessage.count({ where: { customerId } }),
      prisma.smartListMember.count({ where: { customerId } }),
      prisma.campaignSend.count({ where: { customerId } })
    ]);

    if (subscriptionsCount || paymentsCount || chatwootCount || smartListCount || campaignCount) {
      return res.status(409).json({
        error: "customer_has_dependencies",
        details: { subscriptionsCount, paymentsCount, chatwootCount, smartListCount, campaignCount }
      });
    }

    await prisma.customer.delete({ where: { id: customerId } });
    res.json({ ok: true });
  } catch (err: any) {
    if (String(err?.code) === "P2025") return res.status(404).json({ error: "customer_not_found" });
    if (String(err?.code) === "P2003") return res.status(409).json({ error: "customer_has_dependencies" });
    res.status(500).json({ error: "delete_customer_failed" });
  }
});

customersRouter.post("/:id/wompi/payment-source", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  const parsed = wompiPaymentSourceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });
  if (!customer.email) return res.status(400).json({ error: "customer_email_required" });

  const publicKey = await getWompiPublicKey();
  if (!publicKey) return res.status(400).json({ error: "wompi_public_key_not_configured" });
  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return res.status(400).json({ error: "wompi_private_key_not_configured" });

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  const merchant = await wompi.getMerchant(publicKey);

  const created = await wompi.createPaymentSource({
    type: parsed.data.type,
    token: parsed.data.token,
    customer_email: customer.email,
    acceptance_token: merchant.acceptanceToken,
    accept_personal_auth: merchant.acceptPersonalAuth
  });

  const existing = (customer.metadata ?? {}) as any;
  const existingWompi = existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {};
  const existingSources = Array.isArray(existingWompi?.paymentSources) ? existingWompi.paymentSources : [];
  const nextSources = [
    ...existingSources.filter((s: any) => Number(s?.id) !== created.id),
    { id: created.id, type: parsed.data.type, createdAt: new Date().toISOString() }
  ];
  const merged = {
    ...(existing && typeof existing === "object" ? existing : {}),
    wompi: {
      ...(existingWompi || {}),
      paymentSourceId: created.id,
      paymentSourceType: parsed.data.type,
      paymentSources: nextSources,
      acceptancePermalink: merchant.acceptancePermalink,
      personalDataPermalink: merchant.personalDataPermalink,
      createdAt: new Date().toISOString()
    }
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { metadata: merged as any }
  });

  res.status(201).json({ customer: updated, paymentSourceId: created.id });
});

customersRouter.post("/:id/wompi/payment-source/clear", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "missing_customer_id" });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });

  const sourceIdRaw = Number(req.body?.sourceId ?? 0);
  const existing = (customer.metadata ?? {}) as any;
  const existingWompi = existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {};
  const existingSources = Array.isArray(existingWompi?.paymentSources) ? existingWompi.paymentSources : [];
  const activeId = existingWompi?.paymentSourceId;
  const targetId =
    Number.isFinite(sourceIdRaw) && sourceIdRaw > 0 ? sourceIdRaw : Number(activeId || 0) || 0;

  const nextSources = targetId
    ? existingSources.filter((s: any) => Number(s?.id) !== targetId)
    : existingSources;
  const nextActive = nextSources.length ? nextSources[nextSources.length - 1] : null;

  const merged = {
    ...(existing && typeof existing === "object" ? existing : {}),
    wompi: {
      ...(existingWompi || {}),
      paymentSourceId: nextActive?.id ?? null,
      paymentSourceType: nextActive?.type ?? null,
      paymentSources: nextSources
    }
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { metadata: merged as any }
  });

  res.status(200).json({ ok: true, customer: updated, paymentSourceId: nextActive?.id ?? null });
});
