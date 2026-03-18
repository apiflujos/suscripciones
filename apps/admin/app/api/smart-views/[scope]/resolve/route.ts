import { NextResponse } from "next/server";
import { requireApiSession } from "../../../_lib/requireApiSession";
import { resolveSmartViewIds, normalizeSmartViewScope, parseFiltersParam } from "@suscripciones/core/services/smartViews";

type RouteContext = { params: Promise<{ scope: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope") => {
  const params = await paramsPromise;
  const raw = params?.[key] || "";
  return String(raw).trim();
};

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const scope = await getParam(ctx.params, "scope");
  const normalizedScope = normalizeSmartViewScope(String(scope || ""));
  if (!normalizedScope) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const viewId = String(body?.id || body?.viewId || "").trim();
  const rules = body?.filters ? parseFiltersParam(body?.filters) : null;

  const ids = await resolveSmartViewIds(
    normalizedScope,
    auth.session.tenantId || null,
    auth.session.email || null,
    viewId || undefined,
    rules || undefined
  );

  return NextResponse.json({ items: ids || [] });
}
