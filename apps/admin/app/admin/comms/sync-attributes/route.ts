import { requireAdminToken } from "../../_lib/requireAdminToken";
import { syncContactsAttributes } from "../../_services/comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 2000) : 200;
  const result = await syncContactsAttributes(limit);
  return Response.json(result);
}
