import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { LogLevel, PlanIntervalUnit, PlanType } from "@prisma/client";
import { consumeApp } from "../services/superAdminApp";
import { systemLog } from "../services/systemLog";
import { getEffectiveTenantId, getEffectiveTenantIds, readTenantIdsFromReq } from "../services/tenantContext";
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from "../lib/currencies";

const currencyCodeSchema = z
  .preprocess((v) => normalizeCurrencyCode(v), z.string().min(3).max(3))
  .refine((v) => isSupportedCurrency(v), { message: "unsupported_currency" });

const createPlanSchema = z.object({
  name: z.string().min(1),
  priceInCents: z.number().int().positive(),
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
  intervalUnit: z.nativeEnum(PlanIntervalUnit),
  intervalCount: z.number().int().positive().default(1),
  collectionMode: z.enum(["MANUAL_LINK", "AUTO_LINK", "AUTO_DEBIT"]).optional().default("MANUAL_LINK"),
  planType: z.nativeEnum(PlanType).optional(),
  active: z.boolean().optional(),
  metadata: z.any().optional()
});

const updatePlanSchema = z.object({
  intervalUnit: z.nativeEnum(PlanIntervalUnit).optional(),
  intervalCount: z.number().int().positive().optional()
});

export const plansRouter = express.Router();

plansRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const tenantId = await getEffectiveTenantId(req);
  const takeRaw = Number(req?.query?.take ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 200;
  const q = String(req?.query?.q ?? "").trim();
  const mode = String(req?.query?.collectionMode ?? "").trim();

  const where: any = { NOT: { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } } as any;
  const and: any[] = [];
  if (tenantId) {
    const tenantFilter = { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] };
    and.push(tenantFilter);
  }
  if (mode) and.push({ metadata: { path: ["collectionMode"], equals: mode } } as any);
  if (and.length) where.AND = and;

  // For search queries, fetch a broader window and filter in-memory across
  // name + metadata display fields so "servicios/productos" are found reliably.
  const rawItems = await prisma.subscriptionPlan.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q ? Math.max(take, 2000) : take,
    include: { tenantLinks: true }
  });
  const qNorm = q.toLowerCase();
  const items = q
    ? rawItems.filter((p: any) => {
        const md = p?.metadata && typeof p.metadata === "object" ? (p.metadata as any) : {};
        const catalog = md?.catalog && typeof md.catalog === "object" ? md.catalog : {};
        const searchable = [
          p?.name,
          p?.id,
          md?.displayName,
          md?.sku,
          catalog?.name,
          catalog?.title
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        return searchable.includes(qNorm);
      }).slice(0, take)
    : rawItems;
  res.json({
    items: items.map((p: any) => ({
      ...p,
      tenantIds: Array.from(new Set([p.tenantId, ...(p.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[]
    }))
  });
});

plansRouter.post("/", async (req, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenantIds = await getEffectiveTenantIds(req);
  if (!tenantIds.length) return res.status(400).json({ error: "tenant_required" });
  const primaryTenantId = tenantIds[0];
  const { collectionMode, planType, metadata, ...rest } = parsed.data;
  const mergedMetadata = {
    ...(metadata && typeof metadata === "object" ? (metadata as any) : {}),
    collectionMode
  };

  const computedPlanType: PlanType = planType ?? (collectionMode === "MANUAL_LINK" ? PlanType.manual_link : PlanType.auto_subscription);
  const plan = await prisma.subscriptionPlan.create({
    data: { ...(rest as any), tenantId: primaryTenantId, planType: computedPlanType as any, metadata: mergedMetadata as any }
  });
  await prisma.subscriptionPlanTenant.createMany({
    data: tenantIds.map((t) => ({ planId: plan.id, tenantId: t })),
    skipDuplicates: true
  });
  await consumeApp("plans_created", { amount: 1, source: "api:plans.create", meta: { planId: plan.id, planType: plan.planType } });
  res.status(201).json({ plan });
});

plansRouter.delete("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return res.status(404).json({ error: "not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "not_found" });
  }
  if ((plan.metadata as any)?.kind === "CATALOG_ITEM") return res.status(404).json({ error: "not_found" });

  const [subscriptionsCount, paymentLinksCount] = await Promise.all([
    prisma.subscription.count({ where: { planId: id } }),
    prisma.paymentLink.count({ where: { planId: id } })
  ]);

  const force = String((req as any)?.query?.force || "").trim() === "1";
  if (!force && (subscriptionsCount || paymentLinksCount)) {
    return res.status(409).json({
      error: "plan_has_dependencies",
      details: { subscriptionsCount, paymentLinksCount }
    });
  }

  if (force) {
    const subs = await prisma.subscription.findMany({ where: { planId: id }, select: { id: true } });
    const subIds = subs.map((s: any) => s.id);
    const payments = await prisma.payment.findMany({ where: { subscriptionId: { in: subIds } }, select: { id: true } });
    const paymentIds = payments.map((p: any) => p.id);

    if (paymentIds.length) {
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
    }
    await prisma.chatwootMessage.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.paymentLink.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
    await prisma.subscription.deleteMany({ where: { id: { in: subIds } } }).catch(() => {});
    await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: id } }).catch(() => {});
  }

  await prisma.subscriptionPlan.delete({ where: { id } });
  await systemLog(LogLevel.INFO, "plans.delete", "Plan deleted", { planId: id }).catch(() => {});
  res.json({ ok: true });
});

plansRouter.put("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const parsed = updatePlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return res.status(404).json({ error: "not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "not_found" });
  }

  const data: any = {};
  if (parsed.data.intervalUnit) data.intervalUnit = parsed.data.intervalUnit;
  if (parsed.data.intervalCount) data.intervalCount = parsed.data.intervalCount;

  if (!Object.keys(data).length) return res.json({ ok: true, plan });

  const updated = await prisma.subscriptionPlan.update({ where: { id }, data });
  await systemLog(LogLevel.INFO, "plans.update", "Plan updated", { planId: id }).catch(() => {});
  res.json({ plan: updated });
});
