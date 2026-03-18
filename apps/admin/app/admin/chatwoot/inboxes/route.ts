import { requireAdminToken } from "../../_lib/requireAdminToken";
import { listChatwootInboxes } from "../../_services/chatwoot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const out = await listChatwootInboxes();
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json({ items: out.items });
}
