import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { retryFailedWebhooks } from "../../../_services/logsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;
  const out = await retryFailedWebhooks();
  return Response.json(out);
}
