import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { normalizeSmartViewScope, parseFiltersParam, resolveSmartViewIds } from "@suscripciones/core/services/smartViews";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { readActorEmail } from "../../_lib";

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
  const { viewId, filters } = body || {};
  const parsed = filters ? parseFiltersParam(JSON.stringify(filters)) : null;
  const actorEmail = readActorEmail(req);
  const ids = await resolveSmartViewIds(scope, tenantId, actorEmail, viewId, parsed || undefined);
  if (ids === null) return Response.json({ ids: null, count: null });
  return Response.json({ ids, count: ids.length });
}
