import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tenantCreateSchema = z.object({
  name: z.string().min(1),
  active: z.boolean().optional(),
  metadata: z.any().optional()
});

export async function PUT(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const tenantId = String(params?.tenantId || "");
  const body = await req.json().catch(() => null);
  const parsed = tenantCreateSchema.partial().safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const t = await prisma.saTenant.update({
    where: { id: tenantId },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.active != null ? { active: parsed.data.active } : {}),
      ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata ?? null } : {})
    } as any
  });
  return Response.json({ tenant: t });
}
