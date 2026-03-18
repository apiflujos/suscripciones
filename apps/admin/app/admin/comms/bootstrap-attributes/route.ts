import { requireAdminToken } from "../../_lib/requireAdminToken";
import { bootstrapChatwootAttributes } from "../../_services/comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const out = await bootstrapChatwootAttributes();
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json(out);
}
