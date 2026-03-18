import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { computeSmartViewIds, normalizeSmartViewScope, parseFiltersParam } from "@suscripciones/core/services/smartViews";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ scope: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const scope = normalizeSmartViewScope(String(params?.scope || ""));
  if (!scope) return Response.json({ error: "invalid_scope" }, { status: 400 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const rules = parseFiltersParam(JSON.stringify(body?.filters ?? body?.rules ?? body?.filter ?? null));
  if (!rules) return Response.json({ error: "invalid_filters" }, { status: 400 });

  const ids = await computeSmartViewIds(scope, tenantId, rules);
  return Response.json({ ids, count: ids.length });
}
