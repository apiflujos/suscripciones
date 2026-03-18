import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const tenantId = String(params?.tenantId || "");
  const body = await req.json().catch(() => null);
  const parsed = assignPlanSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const tenant = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return Response.json({ error: "tenant_not_found" }, { status: 404 });

  let snapshot: any;
  try {
    snapshot = await buildSnapshot(parsed.data.planId);
  } catch (err: any) {
    return Response.json({ error: err?.message ? String(err.message) : "plan_not_found" }, { status: 404 });
  }

  const snap = await prisma.$transaction(async (tx) => {
    await tx.saTenantPlanSnapshot.updateMany({ where: { tenantId, active: true }, data: { active: false } });
    return tx.saTenantPlanSnapshot.create({ data: { tenantId, planId: parsed.data.planId, active: true, snapshot } as any });
  });

  return Response.json({ snapshot: snap }, { status: 201 });
}
