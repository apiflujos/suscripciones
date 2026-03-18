import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { retryJobById } from "../../../../_services/logsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  const out = await retryJobById(id);
  if (!out.ok) {
    if (out.error === "invalid_id") return Response.json({ error: out.error }, { status: 400 });
    if (out.error === "not_found") return Response.json({ error: out.error }, { status: 404 });
  }
  return Response.json(out);
}
