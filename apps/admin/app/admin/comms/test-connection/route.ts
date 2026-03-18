import { requireAdminToken } from "../../_lib/requireAdminToken";
import { testChatwootConnection } from "../../_services/comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await testChatwootConnection(body || {});
  if (!out.ok) return Response.json({ error: out.error, message: (out as any).message }, { status: out.status });
  return Response.json(out);
}
