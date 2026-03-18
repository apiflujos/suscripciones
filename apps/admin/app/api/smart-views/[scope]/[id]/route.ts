import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireApiSession } from "../../../_lib/requireApiSession";
import {
  normalizeSmartViewScope,
  normalizeSmartViewType,
  normalizeSmartViewVisibility,
  setSmartViewItems
} from "@suscripciones/core/services/smartViews";

type RouteContext = { params: Promise<{ scope: string; id: string }> };

const getParam = async (paramsPromise: RouteContext["params"], key: "scope" | "id") => {
  const params = await paramsPromise;
  const raw = params?.[key] || "";
  return String(raw).trim();
};

const updateSchema = z.object({
  name: z.string().min(1).optional(),
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

export async function DELETE(req: Request, ctx: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const scope = await getParam(ctx.params, "scope");
  const id = await getParam(ctx.params, "id");
  const normalizedScope = normalizeSmartViewScope(String(scope || ""));
  if (!normalizedScope) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const url = new URL(req.url);
  const resolved = resolveTenantId(auth.session.tenantId || null, String(url.searchParams.get("tenantId") || ""));
  if (!resolved.ok) return NextResponse.json({ error: "tenant_forbidden" }, { status: 403 });
  if (!resolved.tenantId) return NextResponse.json({ error: "tenant_required" }, { status: 400 });

  const view = await prisma.smartView.findUnique({ where: { id } });
  if (!view || view.scope !== normalizedScope || view.tenantId !== resolved.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await prisma.smartView.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request, ctx: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const scope = await getParam(ctx.params, "scope");
  const id = await getParam(ctx.params, "id");
  const normalizedScope = normalizeSmartViewScope(String(scope || ""));
  if (!normalizedScope) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const url = new URL(req.url);
  const resolved = resolveTenantId(auth.session.tenantId || null, String(url.searchParams.get("tenantId") || ""));
  if (!resolved.ok) return NextResponse.json({ error: "tenant_forbidden" }, { status: 403 });
  if (!resolved.tenantId) return NextResponse.json({ error: "tenant_required" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.smartView.findUnique({ where: { id } });
  if (!existing || existing.scope !== normalizedScope || existing.tenantId !== resolved.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const visibility = normalizeSmartViewVisibility(parsed.data.visibility || existing.visibility || "ORG");
  const type = normalizeSmartViewType(parsed.data.type || existing.type || "DYNAMIC");
  const filters = parsed.data.filters ?? existing.filters ?? null;

  const updated = await prisma.smartView.update({
    where: { id },
    data: {
      name: parsed.data.name ?? existing.name,
      visibility,
      type,
      filters
    }
  });

  if (type === "STATIC") {
    const ids = Array.isArray(parsed.data.staticIds) ? parsed.data.staticIds : [];
    await setSmartViewItems(updated.id, ids);
  } else if (existing.type === "STATIC") {
    await setSmartViewItems(updated.id, []);
  }

  return NextResponse.json({ view: updated });
}
