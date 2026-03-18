import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../_lib/requireAdminToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gamificationSchema = z
  .object({
    factor: z.number().optional(),
    bonus: z.number().optional(),
    followupMinutes: z.number().int().positive().optional(),
    followupCooldownMinutes: z.number().int().positive().optional(),
    followupMaxAttempts: z.number().int().positive().optional()
  })
  .optional();

const updateTenantSchema = z.object({
  name: z.string().min(1),
  logoUrl: z.string().trim().optional().nullable(),
  gamification: gamificationSchema
});

export async function PUT(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const tenantId = String(params?.tenantId || "").trim();
  if (!tenantId) return Response.json({ error: "missing_tenant_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = updateTenantSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.name.trim();
  const logoUrl = String(parsed.data.logoUrl || "").trim();
  const gamification = parsed.data.gamification;
  const existing = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!existing) return Response.json({ error: "tenant_not_found" }, { status: 404 });
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
      ...(typeof gamification.followupCooldownMinutes === "number"
        ? { followupCooldownMinutes: gamification.followupCooldownMinutes }
        : {}),
      ...(typeof gamification.followupMaxAttempts === "number" ? { followupMaxAttempts: gamification.followupMaxAttempts } : {})
    };
  }
  const updated = await prisma.saTenant.update({ where: { id: tenantId }, data: { name, metadata: nextMeta } });
  return Response.json({ tenant: updated });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const tenantId = String(params?.tenantId || "").trim();
  if (!tenantId) return Response.json({ error: "missing_tenant_id" }, { status: 400 });

  const existing = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!existing) return Response.json({ error: "tenant_not_found" }, { status: 404 });

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
    return Response.json({
      deleted: true,
      archived: true,
      tenant: archived,
      details: { customers, plans, subscriptions, payments, paymentLinks, checkoutTemplates, webhookEvents, chatwootMessages }
    });
  }

  await prisma.saTenant.delete({ where: { id: tenantId } });
  return Response.json({ deleted: true });
}
