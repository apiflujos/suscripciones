import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moduleUpsertSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean().optional()
});

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const items = await prisma.saModuleDefinition.findMany({ orderBy: { key: "asc" } });
  return Response.json({ items });
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const parsed = moduleUpsertSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const m = await prisma.saModuleDefinition.upsert({
    where: { key: parsed.data.key },
    create: { key: parsed.data.key, name: parsed.data.name, active: parsed.data.active ?? true } as any,
    update: { name: parsed.data.name, ...(parsed.data.active != null ? { active: parsed.data.active } : {}) } as any
  });

  return Response.json({ module: m }, { status: 201 });
}
