import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../_lib/requireAdminToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 200;
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const items = await prisma.campaignSend.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "desc" },
    take,
    skip
  });
  return Response.json({ items });
}
