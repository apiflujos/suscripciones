import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { LogLevel, PlanIntervalUnit, PlanType } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updatePlanSchema = z.object({
  intervalUnit: z.nativeEnum(PlanIntervalUnit).optional(),
  intervalCount: z.number().int().positive().optional()
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = updatePlanSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return Response.json({ error: "not_found" }, { status: 404 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return Response.json({ error: "not_found" }, { status: 404 });
  }

  const data: any = {};
  if (parsed.data.intervalUnit) data.intervalUnit = parsed.data.intervalUnit;
  if (parsed.data.intervalCount) data.intervalCount = parsed.data.intervalCount;

  if (!Object.keys(data).length) return Response.json({ ok: true, plan });

  const updated = await prisma.subscriptionPlan.update({ where: { id }, data });
  await systemLog(LogLevel.INFO, "plans.update", "Plan updated", { planId: id }).catch(() => {});
  return Response.json({ plan: updated });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return Response.json({ error: "not_found" }, { status: 404 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return Response.json({ error: "not_found" }, { status: 404 });
  }
  if ((plan.metadata as any)?.kind === "CATALOG_ITEM") return Response.json({ error: "not_found" }, { status: 404 });

  const [subscriptionsCount, paymentLinksCount] = await Promise.all([
    prisma.subscription.count({ where: { planId: id } }),
    prisma.paymentLink.count({ where: { planId: id } })
  ]);

  const force = String(new URL(req.url).searchParams.get("force") || "").trim() === "1";
  if (!force && (subscriptionsCount || paymentLinksCount)) {
    return Response.json({
      error: "plan_has_dependencies",
      details: { subscriptionsCount, paymentLinksCount }
    }, { status: 409 });
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
  return Response.json({ ok: true });
}
