import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { getCustomerRewards } from "../../../../_services/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const result = await getCustomerRewards({ customerId: id });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ global: result.global, byTenant: result.byTenant });
}
