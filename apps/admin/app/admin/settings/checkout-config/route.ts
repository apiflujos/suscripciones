import { requireAdminToken } from "../../_lib/requireAdminToken";
import { updateCheckoutConfig } from "../../_services/settingsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await updateCheckoutConfig(body);
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json(out);
}
