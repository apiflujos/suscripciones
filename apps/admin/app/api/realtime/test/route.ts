import { requireApiSession } from "../../_lib/requireApiSession";
import { writeRealtimeTestLog } from "../../../admin/_services/realtime";
import { publishToChannel } from "../../../../lib/wsHub";

export async function POST(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  await writeRealtimeTestLog();
  publishToChannel("notifications", { kind: "test", by: auth.session.sub });
  return new Response("ok", { status: 200 });
}
