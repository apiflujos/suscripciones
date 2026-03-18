import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../_lib/requireAdminToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });
  const item = await prisma.systemLog.findUnique({ where: { id } });
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ item });
}
