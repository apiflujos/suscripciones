import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { coerceTenantId, getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { getAiHistory } from "../../_services/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const tenantId =
    coerceTenantId(url.searchParams.get("tenantId")) ?? (await getEffectiveTenantId(reqToCompat(req)));
  const take = Math.min(50, Math.max(1, Number(url.searchParams.get("take") ?? 20)));
  const scope = String(url.searchParams.get("scope") || "").trim();
  const customerId = String(url.searchParams.get("customerId") || "").trim();
  const productId = String(url.searchParams.get("productId") || "").trim();
  const result = await getAiHistory({
    tenantId,
    take,
    scope,
    customerId,
    productId
  });
  if (!result.ok) {
    return Response.json({ error: result.error, reason: result.reason }, { status: result.status });
  }
  return Response.json({ items: result.items });
}
