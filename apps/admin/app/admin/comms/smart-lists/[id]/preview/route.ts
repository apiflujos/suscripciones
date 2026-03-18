import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { previewSmartList } from "../../../../_services/smartLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const url = new URL(req.url);
  const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
  const out = await previewSmartList({ id, tenantId });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json({ count: out.count, sample: out.sample });
}
