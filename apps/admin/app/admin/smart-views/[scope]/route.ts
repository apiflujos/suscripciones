import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import {
  computeSmartViewIds,
  listSmartViews,
  normalizeSmartViewScope,
  normalizeSmartViewType,
  normalizeSmartViewVisibility,
  parseFiltersParam,
  setSmartViewItems
} from "@suscripciones/core/services/smartViews";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { readActorEmail } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  visibility: z.string().optional(),
  type: z.string().optional(),
  filters: z.any().optional(),
  staticIds: z.array(z.string()).optional()
});

export async function GET(req: Request, ctx: { params: Promise<{ scope: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const scope = normalizeSmartViewScope(String(params?.scope || ""));
  if (!scope) return Response.json({ error: "invalid_scope" }, { status: 400 });
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  if (!tenantId) return Response.json({ error: "tenant_required" }, { status: 400 });
  const actorEmail = readActorEmail(req);
  const items = await listSmartViews(scope, tenantId, actorEmail);
  return Response.json({ items });
}

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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const actorEmail = readActorEmail(req);
  const visibility = normalizeSmartViewVisibility(parsed.data.visibility || "ORG");
  const type = normalizeSmartViewType(parsed.data.type || "DYNAMIC");
  const created = await prisma.smartView.create({
    data: {
      tenantId,
      name: parsed.data.name,
      scope,
      visibility,
      type,
      filters: parsed.data.filters ?? null,
      createdByEmail: actorEmail || null
    }
  });

  if (type === "STATIC") {
    const ids = Array.isArray(parsed.data.staticIds) ? parsed.data.staticIds : [];
    await setSmartViewItems(created.id, ids);
  }

  return Response.json({ view: created }, { status: 201 });
}
