import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  return Response.json({ ok: true, email: String(sa.sa.email || "").trim() || null });
}
