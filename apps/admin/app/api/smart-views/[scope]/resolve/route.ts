import { NextResponse } from "next/server";
import { requireApiSession } from "../../../_lib/requireApiSession";
import { resolveSmartViewIds, normalizeSmartViewScope, parseFiltersParam } from "@suscripciones/core/services/smartViews";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";

type RouteContext = { params: Promise<{ scope: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope") => {
  const params = await paramsPromise;
  const raw = params?.[key] || "";
  return String(raw).trim();
};

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const scope = await getParam(ctx.params, "scope");
  const normalizedScope = normalizeSmartViewScope(String(scope || ""));
  if (!normalizedScope) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const viewId = String(body?.id || body?.viewId || "").trim();
  const rules = body?.filters ? parseFiltersParam(body?.filters) : null;

  const tenantId = auth.session.tenantId || (await getDefaultTenantId()) || null;
  const ids = await resolveSmartViewIds(
    normalizedScope,
    tenantId,
    auth.session.sub || null,
    viewId || undefined,
    rules || undefined
  );

  return NextResponse.json({ items: ids || [] });
}
