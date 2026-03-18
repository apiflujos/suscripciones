import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaPlanKind } from "@prisma/client";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  kind: z.nativeEnum(SaPlanKind),
  monthlyPriceInCents: z.number().int().nonnegative().optional(),
  active: z.boolean().optional()
});

export async function PUT(req: Request, ctx: { params: Promise<{ planId: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const planId = String(params?.planId || "");
  const body = await req.json().catch(() => null);
  const parsed = planCreateSchema.partial().safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

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

  return Response.json({ plan });
}
