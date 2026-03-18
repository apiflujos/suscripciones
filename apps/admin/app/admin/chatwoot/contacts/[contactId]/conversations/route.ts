import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { listChatwootContactConversations } from "../../../../_services/chatwoot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ contactId: string }> };

export async function GET(req: Request, ctx: RouteContext) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const { contactId } = await ctx.params;
  const result = await listChatwootContactConversations(Number(contactId));
  if (!result.ok) return Response.json({ error: result.error, details: (result as any).details }, { status: result.status });
  return Response.json(result.payload ?? { payload: [] });
}
