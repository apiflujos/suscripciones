import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaPlanKind } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  kind: z.nativeEnum(SaPlanKind),
  monthlyPriceInCents: z.number().int().nonnegative().optional(),
  active: z.boolean().optional()
});

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const items = await prisma.saPlanDefinition.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { services: { orderBy: { serviceKey: "asc" } } }
  });
  return Response.json({ items });
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const parsed = planCreateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const plan = await prisma.saPlanDefinition.create({
    data: {
      key: parsed.data.key,
      name: parsed.data.name,
      kind: parsed.data.kind,
      monthlyPriceInCents: parsed.data.monthlyPriceInCents ?? 0,
      active: parsed.data.active ?? true
    } as any
  });
  return Response.json({ plan }, { status: 201 });
}
