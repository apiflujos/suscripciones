import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { getSmartViewFields, normalizeSmartViewScope } from "@suscripciones/core/services/smartViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ scope: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const scope = normalizeSmartViewScope(String(params?.scope || ""));
  if (!scope) return Response.json({ error: "invalid_scope" }, { status: 400 });
  return Response.json({ fields: getSmartViewFields(scope) });
}
