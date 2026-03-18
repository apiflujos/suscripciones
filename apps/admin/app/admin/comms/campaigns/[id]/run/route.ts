import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { runCampaign } from "../../../../_services/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const out = await runCampaign(id);
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json(out);
}
