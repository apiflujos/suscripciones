import { requireApiSession } from "../../_lib/requireApiSession";
import { reqToCompat } from "../../../admin/_lib/reqCompat";
import { coerceTenantId, getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { getAiHistory } from "../../../admin/_services/ai";

export async function GET(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const take = Math.min(50, Math.max(1, Number(url.searchParams.get("take") ?? 20)));
  const tenantId =
    coerceTenantId(url.searchParams.get("tenantId")) ?? (await getEffectiveTenantId(reqToCompat(req)));
  const scope = String(url.searchParams.get("scope") || "").trim();
  const customerId = String(url.searchParams.get("customerId") || "").trim();
  const productId = String(url.searchParams.get("productId") || "").trim();

  const result = await getAiHistory({ tenantId, take, scope, customerId, productId });
  if (!result.ok) {
    return Response.json({ error: result.error, reason: result.reason }, { status: result.status });
  }
  return Response.json({ items: result.items }, { headers: { "Cache-Control": "no-store" } });
}
