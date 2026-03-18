import { requireAdminToken } from "../_lib/requireAdminToken";
import { getAdminSettings } from "../_services/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const payload = await getAdminSettings();
  return Response.json(payload);
}
