import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { deleteSmartList, getSmartListById, updateSmartList } from "../../../_services/smartLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const out = await getSmartListById({ id, tenantId });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json({ smartList: out.smartList });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const body = await req.json().catch(() => null);
  const compatReq = reqToCompat(req, body);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const out = await updateSmartList({ id, tenantId, ...(body || {}) });
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json({ smartList: out.smartList });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const out = await deleteSmartList({ id, tenantId });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json(out);
}
