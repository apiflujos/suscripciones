import "server-only";

import { prisma } from "@suscripciones/database";

export async function listTenants() {
  return prisma.saTenant.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
    take: 500
  });
}

export async function createTenant(args: { name: string; logoUrl?: string | null; gamification?: any }) {
  const name = String(args.name || "").trim();
  if (!name) return { ok: false, status: 400, error: "tenant_name_required" as const };

  const existing = await prisma.saTenant.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return { ok: true, tenant: existing, created: false };

  const logoUrl = String(args.logoUrl || "").trim();
  const gamification = args.gamification && typeof args.gamification === "object" ? args.gamification : null;
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
  return { ok: true, tenant, created: true };
}

export async function updateTenant(args: {
  tenantId: string;
  name: string;
  logoUrl?: string | null;
  gamification?: any;
}) {
  const tenantId = String(args.tenantId || "").trim();
  const name = String(args.name || "").trim();
  if (!tenantId) return { ok: false, status: 400, error: "missing_tenant_id" as const };
  if (!name) return { ok: false, status: 400, error: "tenant_name_required" as const };

  const existing = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!existing) return { ok: false, status: 404, error: "tenant_not_found" as const };

  const logoUrl = String(args.logoUrl || "").trim();
  const existingMeta = existing.metadata && typeof existing.metadata === "object" ? (existing.metadata as any) : {};
  const gamification = args.gamification && typeof args.gamification === "object" ? args.gamification : {};
  const nextMeta: any = { ...existingMeta };
  if (logoUrl) nextMeta.logoUrl = logoUrl;
  if (Object.keys(gamification).length) {
    nextMeta.gamification = {
      ...(existingMeta?.gamification && typeof existingMeta.gamification === "object" ? existingMeta.gamification : {}),
      ...(typeof gamification.factor === "number" ? { factor: gamification.factor } : {}),
      ...(typeof gamification.bonus === "number" ? { bonus: gamification.bonus } : {}),
      ...(typeof gamification.followupMinutes === "number" ? { followupMinutes: gamification.followupMinutes } : {}),
      ...(typeof gamification.followupCooldownMinutes === "number" ? { followupCooldownMinutes: gamification.followupCooldownMinutes } : {}),
      ...(typeof gamification.followupMaxAttempts === "number" ? { followupMaxAttempts: gamification.followupMaxAttempts } : {})
    };
  }

  const updated = await prisma.saTenant.update({
    where: { id: tenantId },
    data: {
      name,
      metadata: nextMeta
    }
  });
  return { ok: true, tenant: updated };
}

export async function deleteTenant(args: { tenantId: string }) {
  const tenantId = String(args.tenantId || "").trim();
  if (!tenantId) return { ok: false, status: 400, error: "missing_tenant_id" as const };

  const existing = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!existing) return { ok: false, status: 404, error: "tenant_not_found" as const };

  const [customers, plans, subscriptions, payments, paymentLinks, checkoutTemplates] = await Promise.all([
    prisma.customer.count({ where: { tenantId } }),
    prisma.subscriptionPlan.count({ where: { tenantId } }),
    prisma.subscription.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.paymentLink.count({ where: { tenantId } }),
    prisma.publicCheckoutTemplate.count({ where: { tenantId } })
  ]);

  if (customers || plans || subscriptions || payments || paymentLinks || checkoutTemplates) {
    return {
      ok: false,
      status: 409,
      error: "tenant_has_data",
      details: { customers, plans, subscriptions, payments, paymentLinks, checkoutTemplates }
    };
  }

  const updated = await prisma.saTenant.update({ where: { id: tenantId }, data: { active: false } });
  return { ok: true, archived: true, tenant: updated };
}
