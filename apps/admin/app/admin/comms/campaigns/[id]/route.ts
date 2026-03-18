import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getCampaignById, updateCampaign } from "../../../_services/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const out = await getCampaignById(id);
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json({ campaign: out.campaign });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const body = await req.json().catch(() => null);
  const out = await updateCampaign({ id, input: body });
  if (!out.ok) return Response.json({ error: out.error, details: (out as any).details }, { status: out.status });
  return Response.json({ campaign: out.campaign });
}
