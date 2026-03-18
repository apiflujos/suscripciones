import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const userTenantAssignSchema = z.object({
  tenantIds: z.array(z.string().uuid()).min(0)
});

export async function PUT(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const userId = String(params?.userId || "");
  if (!userId) return Response.json({ error: "invalid_user_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = userTenantAssignSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.saUser.findUnique({ where: { id: userId } });
  if (!user) return Response.json({ error: "user_not_found" }, { status: 404 });

  await prisma.saUserTenant.deleteMany({ where: { userId } });
  if (parsed.data.tenantIds.length) {
    await prisma.saUserTenant.createMany({
      data: parsed.data.tenantIds.map((tenantId) => ({ userId, tenantId })),
      skipDuplicates: true
    });
  }

  return Response.json({ ok: true });
}
