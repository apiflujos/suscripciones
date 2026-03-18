import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { listCustomerGamificationEvents } from "../../../../_services/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 30);
  const tenantId = String(url.searchParams.get("tenantId") || "").trim() || null;
  const includeGlobal = String(url.searchParams.get("includeGlobal") || "1") !== "0";
  const result = await listCustomerGamificationEvents({ customerId: id, tenantId, includeGlobal, take: takeRaw });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ items: result.items });
}
