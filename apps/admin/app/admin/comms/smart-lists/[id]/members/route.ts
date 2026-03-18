import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { listSmartListMembers } from "../../../../_services/smartLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const activeParam = String(url.searchParams.get("active") ?? "").trim();
  const active = activeParam ? activeParam === "1" || activeParam.toLowerCase() === "true" : undefined;
  const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
  const result = await listSmartListMembers({ id, take, skip, active, tenantId: tenantId || null });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ items: result.items, total: result.total });
}
