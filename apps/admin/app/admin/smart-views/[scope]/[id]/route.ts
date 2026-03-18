import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import {
  getSmartViewById,
  normalizeSmartViewScope,
  normalizeSmartViewType,
  normalizeSmartViewVisibility,
  setSmartViewItems
} from "@suscripciones/core/services/smartViews";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { readActorEmail } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  visibility: z.string().optional(),
  type: z.string().optional(),
  filters: z.any().optional(),
  staticIds: z.array(z.string()).optional()
});

export async function GET(req: Request, ctx: { params: Promise<{ scope: string; id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const scope = normalizeSmartViewScope(String(params?.scope || ""));
  if (!scope) return Response.json({ error: "invalid_scope" }, { status: 400 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });
  const actorEmail = readActorEmail(req);
  const view = await getSmartViewById(String(params?.id || ""), tenantId, actorEmail);
  if (!view || view.scope !== scope) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ view });
}

export async function PUT(req: Request, ctx: { params: Promise<{ scope: string; id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const scope = normalizeSmartViewScope(String(params?.scope || ""));
  if (!scope) return Response.json({ error: "invalid_scope" }, { status: 400 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });
  const actorEmail = readActorEmail(req);
  const view = await getSmartViewById(String(params?.id || ""), tenantId, actorEmail);
  if (!view || view.scope !== scope) return Response.json({ error: "not_found" }, { status: 404 });
  if (view.visibility === "PRIVATE" && view.createdByEmail && actorEmail && view.createdByEmail !== actorEmail) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body || {});
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const visibility = parsed.data.visibility ? normalizeSmartViewVisibility(parsed.data.visibility) : view.visibility;
  const type = parsed.data.type ? normalizeSmartViewType(parsed.data.type) : view.type;
  const updated = await prisma.smartView.update({
    where: { id: view.id },
    data: {
      name: parsed.data.name ?? view.name,
      visibility,
      type,
      filters: parsed.data.filters ?? view.filters
    }
  });
  if (type === "STATIC") {
    const ids = Array.isArray(parsed.data.staticIds) ? parsed.data.staticIds : [];
    await setSmartViewItems(view.id, ids);
  }
  return Response.json({ view: updated });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ scope: string; id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const scope = normalizeSmartViewScope(String(params?.scope || ""));
  if (!scope) return Response.json({ error: "invalid_scope" }, { status: 400 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });
  const actorEmail = readActorEmail(req);
  const view = await getSmartViewById(String(params?.id || ""), tenantId, actorEmail);
  if (!view || view.scope !== scope) return Response.json({ error: "not_found" }, { status: 404 });
  if (view.visibility === "PRIVATE" && view.createdByEmail && actorEmail && view.createdByEmail !== actorEmail) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  await prisma.smartView.delete({ where: { id: view.id } });
  return Response.json({ ok: true });
}
