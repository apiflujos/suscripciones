import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getPaymentsHealth } from "../../../_services/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;
  const out = await getPaymentsHealth();
  return Response.json(out);
}
