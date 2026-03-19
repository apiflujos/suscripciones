import { NextResponse } from "next/server";
import { requireApiSession } from "../../../_lib/requireApiSession";
import { getSmartViewOptions, normalizeSmartViewScope } from "@suscripciones/core/services/smartViews";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";

type RouteContext = { params: Promise<{ scope: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope") => {
  const params = await paramsPromise;
  const raw = params?.[key] || "";
  return String(raw).trim();
};

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const scope = await getParam(ctx.params, "scope");
  const normalizedScope = normalizeSmartViewScope(String(scope || ""));
  if (!normalizedScope) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const url = new URL(req.url);
  const field = url.searchParams.get("field") || "";
  if (!field) return NextResponse.json({ items: [] });

  const tenantId = auth.session.tenantId || (await getDefaultTenantId()) || null;
  const items = await getSmartViewOptions(normalizedScope, String(field), tenantId);
  return NextResponse.json({ items });
}
