import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { createSmartList, listSmartLists } from "../../_services/smartLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 100);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 100;
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const out = await listSmartLists({ tenantId, take, skip });
  return Response.json(out);
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const compatReq = reqToCompat(req, body);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const out = await createSmartList({ tenantId, ...(body || {}) });
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json({ smartList: out.smartList }, { status: 201 });
}
