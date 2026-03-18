import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { getPaymentStatus } from "../../_services/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const id = String(params?.id || "").trim();
  const result = await getPaymentStatus({ paymentId: id, tenantId });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ payment: result.payment, lastAttempt: result.lastAttempt });
}
