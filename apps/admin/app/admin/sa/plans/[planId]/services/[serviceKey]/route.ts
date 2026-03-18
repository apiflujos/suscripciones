import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planServiceSchema = z.object({
  isUnlimited: z.boolean().optional(),
  maxValue: z.number().int().nonnegative().nullable().optional(),
  unitPriceInCents: z.number().int().nonnegative().optional()
});

export async function PUT(req: Request, ctx: { params: Promise<{ planId: string; serviceKey: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const planId = String(params?.planId || "");
  const serviceKey = String(params?.serviceKey || "");
  const body = await req.json().catch(() => null);
  const parsed = planServiceSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

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

  return Response.json({ limit: row });
}
