import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { testShopifyForward } from "../../../_services/settingsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await testShopifyForward(body);
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json(out);
}
