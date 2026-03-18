import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaPeriodType } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limitUpsertSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  periodType: z.nativeEnum(SaPeriodType),
  moduleKey: z.string().min(1).optional().nullable(),
  active: z.boolean().optional()
});

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const items = await prisma.saLimitDefinition.findMany({ orderBy: { key: "asc" } });
  return Response.json({ items });
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const parsed = limitUpsertSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const item = await prisma.saLimitDefinition.upsert({
    where: { key: parsed.data.key },
    create: {
      key: parsed.data.key,
      name: parsed.data.name,
      periodType: parsed.data.periodType,
      moduleKey: parsed.data.moduleKey ? String(parsed.data.moduleKey).trim() : null,
      active: parsed.data.active ?? true
    } as any,
    update: {
      name: parsed.data.name,
      periodType: parsed.data.periodType,
      ...(parsed.data.moduleKey !== undefined
        ? { moduleKey: parsed.data.moduleKey ? String(parsed.data.moduleKey).trim() : null }
        : {}),
      ...(parsed.data.active != null ? { active: parsed.data.active } : {})
    } as any
  });

  return Response.json({ item }, { status: 201 });
}
