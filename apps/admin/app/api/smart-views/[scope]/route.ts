import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireApiSession } from "../../_lib/requireApiSession";
import {
  listSmartViews,
  normalizeSmartViewScope,
  normalizeSmartViewType,
  normalizeSmartViewVisibility,
  setSmartViewItems
} from "@suscripciones/core/services/smartViews";

type RouteContext = { params: Promise<{ scope: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope") => {
  const params = await paramsPromise;
  const raw = params?.[key] || "";
  return String(raw).trim();
};

const createSchema = z.object({
  name: z.string().min(1),
  visibility: z.string().optional(),
  type: z.string().optional(),
  filters: z.any().optional(),
  staticIds: z.array(z.string()).optional()
});

function resolveTenantId(sessionTenantId: string | null | undefined, paramTenantId: string) {
  const param = String(paramTenantId || "").trim();
  if (sessionTenantId && param && param !== sessionTenantId) return { ok: false as const, tenantId: null };
  return { ok: true as const, tenantId: sessionTenantId || param || "" };
}

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const scope = await getParam(ctx.params, "scope");
  const normalizedScope = normalizeSmartViewScope(String(scope || ""));
  if (!normalizedScope) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const url = new URL(req.url);
  const resolved = resolveTenantId(auth.session.tenantId || null, String(url.searchParams.get("tenantId") || ""));
  if (!resolved.ok) return NextResponse.json({ error: "tenant_forbidden" }, { status: 403 });
  if (!resolved.tenantId) return NextResponse.json({ error: "tenant_required" }, { status: 400 });

  const items = await listSmartViews(normalizedScope, resolved.tenantId, auth.session.email || "");
  return NextResponse.json({ items });
}

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const scope = await getParam(ctx.params, "scope");
  const normalizedScope = normalizeSmartViewScope(String(scope || ""));
  if (!normalizedScope) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const url = new URL(req.url);
  const resolved = resolveTenantId(auth.session.tenantId || null, String(url.searchParams.get("tenantId") || ""));
  if (!resolved.ok) return NextResponse.json({ error: "tenant_forbidden" }, { status: 403 });
  if (!resolved.tenantId) return NextResponse.json({ error: "tenant_required" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const visibility = normalizeSmartViewVisibility(parsed.data.visibility || "ORG");
  const type = normalizeSmartViewType(parsed.data.type || "DYNAMIC");
  const created = await prisma.smartView.create({
    data: {
      tenantId: resolved.tenantId,
      name: parsed.data.name,
      scope: normalizedScope,
      visibility,
      type,
      filters: parsed.data.filters ?? null,
      createdByEmail: auth.session.email || null
    }
  });

  if (type === "STATIC") {
    const ids = Array.isArray(parsed.data.staticIds) ? parsed.data.staticIds : [];
    await setSmartViewItems(created.id, ids);
  }

  return NextResponse.json({ view: created }, { status: 201 });
}
