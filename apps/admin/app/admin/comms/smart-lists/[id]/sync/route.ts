import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { syncSmartList } from "../../../../_services/smartLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const out = await syncSmartList({ id });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json(out);
}
