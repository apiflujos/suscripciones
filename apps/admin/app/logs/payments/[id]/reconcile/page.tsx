import { PageShell } from "../../../../ui/PageShell";
import { getCsrfToken } from "../../../../lib/csrf";
import { resolveReturnTo } from "../../../../lib/returnTo";
import { loadPayment, requireSuperAdmin } from "../../../loadPayment";
import { ReconcileForm } from "../../../ReconcileForm";

export const dynamic = "force-dynamic";

/** Reconciliar un pago concreto con Wompi: los identificadores llegan rellenos. */
export default async function ReconcilePaymentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/payments");
  const [payment, csrfToken] = await Promise.all([loadPayment(id), getCsrfToken()]);
  const who = String(payment.customer?.name || payment.subscription?.customer?.name || "").trim();
  return (
    <PageShell
      title="Reconciliar pago Wompi"
      subtitle={[who, payment.reference].filter(Boolean).join(" · ") || undefined}
      crumbs={[{ label: "Pagos", href: returnTo }, { label: who || "Pago" }, { label: "Reconciliar" }]}
      backHref={returnTo}
    >
      <ReconcileForm
        csrfToken={csrfToken}
        returnTo={returnTo}
        defaults={{
          paymentId: String(payment.id || ""),
          reference: String(payment.reference || ""),
          wompiTransactionId: String(payment.wompiTransactionId || ""),
          wompiPaymentLinkId: String(payment.wompiPaymentLinkId || ""),
          tenantId: String(payment.tenantId || ""),
          amountInCents: Number(payment.amountInCents || 0),
          currency: String(payment.currency || "COP")
        }}
      />
    </PageShell>
  );
}
