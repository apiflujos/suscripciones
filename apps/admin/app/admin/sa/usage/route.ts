import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaPeriodType } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const usageQuerySchema = z.object({
  tenantId: z.string().uuid(),
  periodKey: z.string().min(1)
});

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const url = new URL(req.url);
  const parsed = usageQuerySchema.safeParse({
    tenantId: url.searchParams.get("tenantId") ?? "",
    periodKey: url.searchParams.get("periodKey") ?? ""
  });
  if (!parsed.success) {
    return Response.json({ error: "invalid_query", details: parsed.error.flatten() }, { status: 400 });
  }

  const limitDefs = await prisma.saLimitDefinition.findMany({ orderBy: { key: "asc" } });
  const pks = [parsed.data.periodKey, "total"];
  const usage = await prisma.saUsageCounter.findMany({ where: { tenantId: parsed.data.tenantId, periodKey: { in: pks } } });
  const billing = await prisma.saBillingCounter.findMany({ where: { tenantId: parsed.data.tenantId, periodKey: { in: pks } } });

  const usageByKey = new Map<string, number>();
  for (const u of usage) usageByKey.set(`${u.serviceKey}:${u.periodKey}`, u.total);

  const billByKey = new Map<string, { q: number; cents: number }>();
  for (const b of billing) billByKey.set(`${b.serviceKey}:${b.periodKey}`, { q: b.totalQuantity, cents: b.totalInCents });

  const items = limitDefs.map((d: any) => {
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
    billedInCents: items.reduce((acc: number, x: any) => acc + x.billedInCents, 0)
  };

  return Response.json({ items, totals });
}
