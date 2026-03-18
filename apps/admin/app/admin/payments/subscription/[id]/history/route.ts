import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { getSubscriptionPaymentHistory } from "../../../../_services/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const subscriptionId = String(params?.id || "").trim();
  if (!subscriptionId) return Response.json({ error: "invalid_subscription_id" }, { status: 400 });

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") || 20);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 50) : 20;
  const pageRaw = Number(url.searchParams.get("page") || 1);
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1;
  const statusRaw = String(url.searchParams.get("status") || "").trim().toUpperCase();
  const result = await getSubscriptionPaymentHistory({
    subscriptionId,
    tenantId,
    take,
    page,
    status: statusRaw
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({
    total: result.total,
    page: result.page,
    take: result.take,
    items: result.items
  });
}
