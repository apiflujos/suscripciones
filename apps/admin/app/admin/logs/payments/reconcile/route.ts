import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reconcilePayment } from "../../../_services/logsActions";
import { detallesDeError, reconciliarPagoSchema } from "../../../../api/_lib/bodySchemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = reconciliarPagoSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: "missing_reconcile_identifiers", detalles: detallesDeError(parsed.error) },
      { status: 400 }
    );
  }
  const d = parsed.data;
  const out = await reconcilePayment({
    paymentId: d.paymentId ?? undefined,
    reference: d.reference ?? undefined,
    wompiPaymentLinkId: (d.wompiPaymentLinkId ?? d.paymentLinkId) ?? undefined,
    wompiTransactionId: (d.wompiTransactionId ?? d.transactionId) ?? undefined,
    tenantId: d.tenantId ?? undefined,
    amountInCents: d.amountInCents ?? (d.amount_in_cents != null ? Number(d.amount_in_cents) : undefined),
    currency: d.currency ?? undefined
  });
  if (!out.ok && (out as any).error === "missing_reconcile_identifiers") {
    return Response.json({ error: "missing_reconcile_identifiers" }, { status: 400 });
  }
  return Response.json(out);
}
