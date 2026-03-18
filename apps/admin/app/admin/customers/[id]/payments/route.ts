import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { getCustomerPayments } from "../../../_services/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const customerId = String(params?.id || "").trim();
  if (!customerId) return Response.json({ error: "invalid_id" }, { status: 400 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;

  const result = await getCustomerPayments({ customerId, tenantId, take, skip });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ items: result.items });
}
