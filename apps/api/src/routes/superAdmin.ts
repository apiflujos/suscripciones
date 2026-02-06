import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireSaSession, revokeSaSession, createSaSession, SUPER_ADMIN_EMAIL, hashPassword } from "../services/superAdminAuth";
import { SaPeriodType, SaPlanKind, SaUserRole } from "@prisma/client";
import { consumeLimitOrBlock } from "../services/superAdminConsume";

export const superAdminRouter = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

superAdminRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    const ip = req.ip ? String(req.ip) : null;
    const ua = req.header("user-agent") || null;
    const session = await createSaSession({ email: parsed.data.email, password: parsed.data.password, ip, userAgent: ua });
    res.json({ token: session.token, expiresAt: session.expiresAt.toISOString(), email: SUPER_ADMIN_EMAIL });
  } catch {
    res.status(401).json({ error: "unauthorized_sa" });
  }
});

superAdminRouter.post("/logout", requireSaSession, async (req, res) => {
  const token = String(req.header("x-sa-session") || req.header("authorization") || "");
  await revokeSaSession(token);
  res.json({ ok: true });
});

superAdminRouter.get("/me", requireSaSession, async (_req, res) => {
  res.json({ ok: true, email: SUPER_ADMIN_EMAIL });
});

const tenantCreateSchema = z.object({
  name: z.string().min(1),
  active: z.boolean().optional(),
  metadata: z.any().optional()
});

superAdminRouter.get("/tenants", requireSaSession, async (_req, res) => {
  const items = await prisma.saTenant.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ items });
});

superAdminRouter.post("/tenants", requireSaSession, async (req, res) => {
  const parsed = tenantCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const t = await prisma.saTenant.create({
    data: { name: parsed.data.name, active: parsed.data.active ?? true, metadata: parsed.data.metadata ?? null } as any
  });
  res.status(201).json({ tenant: t });
});

superAdminRouter.put("/tenants/:tenantId", requireSaSession, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const parsed = tenantCreateSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const t = await prisma.saTenant.update({
    where: { id: tenantId },
    data: { ...(parsed.data.name ? { name: parsed.data.name } : {}), ...(parsed.data.active != null ? { active: parsed.data.active } : {}), ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata ?? null } : {}) } as any
  });
  res.json({ tenant: t });
});

const moduleUpsertSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean().optional()
});

superAdminRouter.get("/modules", requireSaSession, async (_req, res) => {
  const items = await prisma.saModuleDefinition.findMany({ orderBy: { key: "asc" } });
  res.json({ items });
});

superAdminRouter.post("/modules", requireSaSession, async (req, res) => {
  const parsed = moduleUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const m = await prisma.saModuleDefinition.upsert({
    where: { key: parsed.data.key },
    create: { key: parsed.data.key, name: parsed.data.name, active: parsed.data.active ?? true } as any,
    update: { name: parsed.data.name, ...(parsed.data.active != null ? { active: parsed.data.active } : {}) } as any
  });
  res.status(201).json({ module: m });
});

const tenantModuleToggleSchema = z.object({
  enabled: z.boolean()
});

superAdminRouter.put("/tenants/:tenantId/modules/:moduleKey", requireSaSession, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const moduleKey = String(req.params.moduleKey || "");
  const parsed = tenantModuleToggleSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const t = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!t) return res.status(404).json({ error: "tenant_not_found" });

  const def = await prisma.saModuleDefinition.findUnique({ where: { key: moduleKey } });
  if (!def) return res.status(404).json({ error: "module_not_found" });

  const toggle = await prisma.saTenantModuleToggle.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
    create: { tenantId, moduleKey, enabled: parsed.data.enabled } as any,
    update: { enabled: parsed.data.enabled } as any
  });
  res.json({ toggle });
});

const limitUpsertSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  periodType: z.nativeEnum(SaPeriodType),
  active: z.boolean().optional()
});

superAdminRouter.get("/limits", requireSaSession, async (_req, res) => {
  const items = await prisma.saLimitDefinition.findMany({ orderBy: { key: "asc" } });
  res.json({ items });
});

superAdminRouter.post("/limits", requireSaSession, async (req, res) => {
  const parsed = limitUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const item = await prisma.saLimitDefinition.upsert({
    where: { key: parsed.data.key },
    create: { key: parsed.data.key, name: parsed.data.name, periodType: parsed.data.periodType, active: parsed.data.active ?? true } as any,
    update: { name: parsed.data.name, periodType: parsed.data.periodType, ...(parsed.data.active != null ? { active: parsed.data.active } : {}) } as any
  });
  res.status(201).json({ item });
});

const planCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  kind: z.nativeEnum(SaPlanKind),
  monthlyPriceInCents: z.number().int().nonnegative().optional(),
  active: z.boolean().optional()
});

superAdminRouter.get("/plans", requireSaSession, async (_req, res) => {
  const items = await prisma.saPlanDefinition.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { services: { orderBy: { serviceKey: "asc" } } }
  });
  res.json({ items });
});

superAdminRouter.post("/plans", requireSaSession, async (req, res) => {
  const parsed = planCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const plan = await prisma.saPlanDefinition.create({
    data: {
      key: parsed.data.key,
      name: parsed.data.name,
      kind: parsed.data.kind,
      monthlyPriceInCents: parsed.data.monthlyPriceInCents ?? 0,
      active: parsed.data.active ?? true
    } as any
  });
  res.status(201).json({ plan });
});

superAdminRouter.put("/plans/:planId", requireSaSession, async (req, res) => {
  const planId = String(req.params.planId || "");
  const parsed = planCreateSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const plan = await prisma.saPlanDefinition.update({
    where: { id: planId },
    data: {
      ...(parsed.data.key ? { key: parsed.data.key } : {}),
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.monthlyPriceInCents != null ? { monthlyPriceInCents: parsed.data.monthlyPriceInCents } : {}),
      ...(parsed.data.active != null ? { active: parsed.data.active } : {})
    } as any
  });
  res.json({ plan });
});

const planServiceSchema = z.object({
  isUnlimited: z.boolean().optional(),
  maxValue: z.number().int().nonnegative().nullable().optional(),
  unitPriceInCents: z.number().int().nonnegative().optional()
});

superAdminRouter.put("/plans/:planId/services/:serviceKey", requireSaSession, async (req, res) => {
  const planId = String(req.params.planId || "");
  const serviceKey = String(req.params.serviceKey || "");
  const parsed = planServiceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const row = await prisma.saPlanServiceLimit.upsert({
    where: { planId_serviceKey: { planId, serviceKey } },
    create: {
      planId,
      serviceKey,
      isUnlimited: parsed.data.isUnlimited ?? false,
      maxValue: parsed.data.maxValue ?? null,
      unitPriceInCents: parsed.data.unitPriceInCents ?? 0
    } as any,
    update: {
      ...(parsed.data.isUnlimited != null ? { isUnlimited: parsed.data.isUnlimited } : {}),
      ...(parsed.data.maxValue !== undefined ? { maxValue: parsed.data.maxValue } : {}),
      ...(parsed.data.unitPriceInCents != null ? { unitPriceInCents: parsed.data.unitPriceInCents } : {})
    } as any
  });
  res.json({ limit: row });
});

const assignPlanSchema = z.object({
  planId: z.string().uuid()
});

async function buildSnapshot(planId: string) {
  const plan = await prisma.saPlanDefinition.findUnique({
    where: { id: planId },
    include: { services: true }
  });
  if (!plan) throw new Error("plan_not_found");

  const svc = new Map<string, { isUnlimited: boolean; maxValue: number | null; unitPriceInCents: number }>();
  for (const s of plan.services) {
    svc.set(s.serviceKey, { isUnlimited: s.isUnlimited, maxValue: s.maxValue ?? null, unitPriceInCents: s.unitPriceInCents });
  }

  return {
    planKey: plan.key,
    planName: plan.name,
    kind: plan.kind,
    monthlyPriceInCents: plan.monthlyPriceInCents,
    services: Object.fromEntries(Array.from(svc.entries()).map(([k, v]) => [k, v]))
  };
}

superAdminRouter.post("/tenants/:tenantId/assign-plan", requireSaSession, async (req, res) => {
  const tenantId = String(req.params.tenantId || "");
  const parsed = assignPlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenant = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return res.status(404).json({ error: "tenant_not_found" });

  let snapshot: any;
  try {
    snapshot = await buildSnapshot(parsed.data.planId);
  } catch (err: any) {
    return res.status(404).json({ error: err?.message ? String(err.message) : "plan_not_found" });
  }

  const snap = await prisma.$transaction(async (tx) => {
    await tx.saTenantPlanSnapshot.updateMany({ where: { tenantId, active: true }, data: { active: false } });
    return tx.saTenantPlanSnapshot.create({ data: { tenantId, planId: parsed.data.planId, active: true, snapshot } as any });
  });

  res.status(201).json({ snapshot: snap });
});

const createUserSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([SaUserRole.ADMIN, SaUserRole.AGENT]),
  active: z.boolean().optional()
});

superAdminRouter.get("/users", requireSaSession, async (req, res) => {
  const tenantId = String((req.query as any)?.tenantId ?? "").trim();
  const where: any = tenantId ? { tenantId } : {};
  const items = await prisma.saUser.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ items });
});

superAdminRouter.post("/users", requireSaSession, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const t = await prisma.saTenant.findUnique({ where: { id: parsed.data.tenantId } });
  if (!t) return res.status(404).json({ error: "tenant_not_found" });
  const user = await prisma.saUser.create({
    data: {
      tenantId: parsed.data.tenantId,
      email: parsed.data.email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      active: parsed.data.active ?? true
    } as any
  });
  res.status(201).json({ user });
});

const usageQuerySchema = z.object({
  tenantId: z.string().uuid(),
  periodKey: z.string().min(1)
});

superAdminRouter.get("/usage", requireSaSession, async (req, res) => {
  const parsed = usageQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

  const limitDefs = await prisma.saLimitDefinition.findMany({ orderBy: { key: "asc" } });
  const pks = [parsed.data.periodKey, "total"];
  const usage = await prisma.saUsageCounter.findMany({ where: { tenantId: parsed.data.tenantId, periodKey: { in: pks } } });
  const billing = await prisma.saBillingCounter.findMany({ where: { tenantId: parsed.data.tenantId, periodKey: { in: pks } } });

  const usageByKey = new Map<string, number>();
  for (const u of usage) usageByKey.set(`${u.serviceKey}:${u.periodKey}`, u.total);

  const billByKey = new Map<string, { q: number; cents: number }>();
  for (const b of billing) billByKey.set(`${b.serviceKey}:${b.periodKey}`, { q: b.totalQuantity, cents: b.totalInCents });

  const items = limitDefs.map((d) => {
    const pk = d.periodType === SaPeriodType.total ? "total" : parsed.data.periodKey;
    const b = billByKey.get(`${d.key}:${pk}`);
    return {
      key: d.key,
      name: d.name,
      periodType: d.periodType,
      usageTotal: usageByKey.get(`${d.key}:${pk}`) ?? 0,
      billedQuantity: b?.q ?? 0,
      billedInCents: b?.cents ?? 0
    };
  });

  const totals = {
    billedInCents: items.reduce((acc, x) => acc + x.billedInCents, 0)
  };
  res.json({ items, totals });
});

const resetSchema = z.object({
  tenantId: z.string().uuid(),
  periodKey: z.string().min(1)
});

superAdminRouter.post("/usage/reset", requireSaSession, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  await prisma.$transaction(async (tx) => {
    await tx.saUsageCounter.deleteMany({ where: { tenantId: parsed.data.tenantId, periodKey: parsed.data.periodKey } });
    await tx.saBillingCounter.deleteMany({ where: { tenantId: parsed.data.tenantId, periodKey: parsed.data.periodKey } });
  });
  res.json({ ok: true });
});

const consumeSchema = z.object({
  tenantId: z.string().uuid(),
  serviceKey: z.string().min(1),
  amount: z.number().int().positive().optional().default(1),
  source: z.string().optional(),
  meta: z.any().optional()
});

superAdminRouter.post("/consume", requireSaSession, async (req, res) => {
  const parsed = consumeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const out = await consumeLimitOrBlock(parsed.data.serviceKey, {
      tenantId: parsed.data.tenantId,
      amount: parsed.data.amount,
      source: parsed.data.source,
      meta: parsed.data.meta
    });
    res.json(out);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ? String(err.message) : "consume_failed" });
  }
});
