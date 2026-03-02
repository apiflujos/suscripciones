import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";

const gamificationSchema = z
  .object({
    factor: z.number().optional(),
    bonus: z.number().optional(),
    followupMinutes: z.number().int().positive().optional(),
    followupCooldownMinutes: z.number().int().positive().optional(),
    followupMaxAttempts: z.number().int().positive().optional()
  })
  .optional();

const createTenantSchema = z.object({
  name: z.string().min(1),
  logoUrl: z.string().trim().optional().nullable(),
  gamification: gamificationSchema
});
const updateTenantSchema = z.object({
  name: z.string().min(1),
  logoUrl: z.string().trim().optional().nullable(),
  gamification: gamificationSchema
});

export const tenantsRouter = express.Router();

tenantsRouter.get("/", async (_req, res) => {
  const items = await prisma.saTenant.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  res.json({ items });
});

tenantsRouter.post("/", async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const name = parsed.data.name.trim();
  const logoUrl = String(parsed.data.logoUrl || "").trim();
  const gamification = parsed.data.gamification;
  const existing = await prisma.saTenant.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return res.status(200).json({ tenant: existing, created: false });

  const meta: any = {};
  if (logoUrl) meta.logoUrl = logoUrl;
  if (gamification) {
    meta.gamification = {
      ...(typeof gamification.factor === "number" ? { factor: gamification.factor } : {}),
      ...(typeof gamification.bonus === "number" ? { bonus: gamification.bonus } : {}),
      ...(typeof gamification.followupMinutes === "number" ? { followupMinutes: gamification.followupMinutes } : {}),
      ...(typeof gamification.followupCooldownMinutes === "number" ? { followupCooldownMinutes: gamification.followupCooldownMinutes } : {}),
      ...(typeof gamification.followupMaxAttempts === "number" ? { followupMaxAttempts: gamification.followupMaxAttempts } : {})
    };
  }

  const tenant = await prisma.saTenant.create({
    data: {
      name,
      active: true,
      ...(Object.keys(meta).length ? { metadata: meta } : {})
    }
  });
  const superAdmins = await prisma.saUser.findMany({ where: { role: "SUPER_ADMIN", active: true }, select: { id: true } });
  if (superAdmins.length) {
    await prisma.saUserTenant.createMany({
      data: superAdmins.map((u: any) => ({ userId: u.id, tenantId: tenant.id })),
      skipDuplicates: true
    });
  }
  res.status(201).json({ tenant, created: true });
});

tenantsRouter.put("/:tenantId", async (req, res) => {
  const tenantId = String(req.params.tenantId || "").trim();
  if (!tenantId) return res.status(400).json({ error: "missing_tenant_id" });
  const parsed = updateTenantSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const name = parsed.data.name.trim();
  const logoUrl = String(parsed.data.logoUrl || "").trim();
  const gamification = parsed.data.gamification;
  const existing = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!existing) return res.status(404).json({ error: "tenant_not_found" });
  const existingMeta = (existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}) as Record<string, any>;
  const nextMeta = { ...existingMeta };
  if (logoUrl) nextMeta.logoUrl = logoUrl;
  if (gamification) {
    const currentGamification = (existingMeta as any).gamification || {};
    nextMeta.gamification = {
      ...currentGamification,
      ...(typeof gamification.factor === "number" ? { factor: gamification.factor } : {}),
      ...(typeof gamification.bonus === "number" ? { bonus: gamification.bonus } : {}),
      ...(typeof gamification.followupMinutes === "number" ? { followupMinutes: gamification.followupMinutes } : {}),
      ...(typeof gamification.followupCooldownMinutes === "number" ? { followupCooldownMinutes: gamification.followupCooldownMinutes } : {}),
      ...(typeof gamification.followupMaxAttempts === "number" ? { followupMaxAttempts: gamification.followupMaxAttempts } : {})
    };
  }
  const updatedMeta = nextMeta;
  const updated = await prisma.saTenant.update({ where: { id: tenantId }, data: { name, metadata: updatedMeta } });
  res.json({ tenant: updated });
});

tenantsRouter.delete("/:tenantId", async (req, res) => {
  const tenantId = String(req.params.tenantId || "").trim();
  if (!tenantId) return res.status(400).json({ error: "missing_tenant_id" });
  const existing = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!existing) return res.status(404).json({ error: "tenant_not_found" });

  const [
    customers,
    plans,
    subscriptions,
    payments,
    paymentLinks,
    checkoutTemplates,
    webhookEvents,
    chatwootMessages
  ] = await prisma.$transaction([
    prisma.customer.count({ where: { tenantId } }),
    prisma.subscriptionPlan.count({ where: { tenantId } }),
    prisma.subscription.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.paymentLink.count({ where: { tenantId } }),
    prisma.publicCheckoutTemplate.count({ where: { tenantId } }),
    prisma.webhookEvent.count({ where: { tenantId } }),
    prisma.chatwootMessage.count({ where: { tenantId } })
  ]);

  const blocking = customers + plans + subscriptions + payments + paymentLinks + checkoutTemplates + webhookEvents + chatwootMessages;
  if (blocking > 0) {
    const archived = await prisma.saTenant.update({ where: { id: tenantId }, data: { active: false } });
    return res.json({
      deleted: true,
      archived: true,
      tenant: archived,
      details: { customers, plans, subscriptions, payments, paymentLinks, checkoutTemplates, webhookEvents, chatwootMessages }
    });
  }

  await prisma.saTenant.delete({ where: { id: tenantId } });
  res.json({ deleted: true });
});
