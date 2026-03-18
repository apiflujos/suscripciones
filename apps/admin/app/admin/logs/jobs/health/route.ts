import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getJobsHealth } from "../../../_services/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;
  const out = await getJobsHealth();
  return Response.json(out);
}
