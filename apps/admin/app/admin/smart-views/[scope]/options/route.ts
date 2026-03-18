import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { getSmartViewOptions, normalizeSmartViewScope } from "@suscripciones/core/services/smartViews";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ scope: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const scope = normalizeSmartViewScope(String(params?.scope || ""));
  if (!scope) return Response.json({ error: "invalid_scope" }, { status: 400 });
  const url = new URL(req.url);
  const field = String(url.searchParams.get("field") || "").trim();
  if (!field) return Response.json({ error: "missing_field" }, { status: 400 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const options = await getSmartViewOptions(scope, field, tenantId);
  return Response.json({ options });
}
