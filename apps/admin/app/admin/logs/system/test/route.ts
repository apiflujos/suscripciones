import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { writeRealtimeTestLog } from "../../../_services/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  await writeRealtimeTestLog();
  return Response.json({ ok: true });
}
