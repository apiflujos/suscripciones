import { requireAdminToken } from "../../../../../_lib/requireAdminToken";
import { clearCustomerPaymentSource } from "../../../../../_services/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const customerId = String(params?.id || "").trim();
  const body = await req.json().catch(() => ({}));
  const sourceId = Number(body?.sourceId ?? 0);

  const result = await clearCustomerPaymentSource({
    customerId,
    sourceId: Number.isFinite(sourceId) && sourceId > 0 ? sourceId : null
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, customer: result.customer, paymentSourceId: result.paymentSourceId });
}
