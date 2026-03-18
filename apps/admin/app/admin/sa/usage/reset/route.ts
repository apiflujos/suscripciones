import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resetSchema = z.object({
  tenantId: z.string().uuid(),
  periodKey: z.string().min(1)
});

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const parsed = resetSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.saUsageCounter.deleteMany({ where: { tenantId: parsed.data.tenantId, periodKey: parsed.data.periodKey } });
    await tx.saBillingCounter.deleteMany({ where: { tenantId: parsed.data.tenantId, periodKey: parsed.data.periodKey } });
  });

  return Response.json({ ok: true });
}
