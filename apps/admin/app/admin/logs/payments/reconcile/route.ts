import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reconcilePayment } from "../../../_services/logsActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const out = await reconcilePayment({
    paymentId: body?.paymentId,
    reference: body?.reference,
    wompiPaymentLinkId: body?.wompiPaymentLinkId || body?.paymentLinkId,
    wompiTransactionId: body?.wompiTransactionId || body?.transactionId,
    tenantId: body?.tenantId,
    amountInCents: body?.amountInCents ?? body?.amount_in_cents,
    currency: body?.currency
  });
  if (!out.ok && (out as any).error === "missing_reconcile_identifiers") {
    return Response.json({ error: "missing_reconcile_identifiers" }, { status: 400 });
  }
  return Response.json(out);
}
