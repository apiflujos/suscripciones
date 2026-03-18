import { requireApiSession } from "../../_lib/requireApiSession";
import { writeRealtimeTestLog } from "../../../admin/_services/realtime";

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  await writeRealtimeTestLog();
  return new Response("ok", { status: 200 });
}
