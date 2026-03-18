import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { createCampaign, listCampaigns } from "../../_services/campaigns";

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
  const idsParam = url.searchParams.get("ids");
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (idsParam !== null && (idsEmpty || ids.length === 0)) {
    return Response.json({ items: [], total: 0 });
  }
  const out = await listCampaigns({ take, skip, ids });
  return Response.json(out);
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const compatReq = reqToCompat(req, body);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const out = await createCampaign({ tenantId, input: body });
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json({ campaign: out.campaign }, { status: 201 });
}
