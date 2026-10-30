import { FormActions, PageSection, PageShell } from "../../../../ui/PageShell";
import { PendingButton } from "../../../../ui/PendingButton";
import { getCsrfToken } from "../../../../lib/csrf";
import { resolveReturnTo } from "../../../../lib/returnTo";
import { associatePayment } from "../../../actions";
import { loadPayment, requireSuperAdmin } from "../../../loadPayment";

export const dynamic = "force-dynamic";

const fmtDate = (d: unknown) => {
  const date = d ? new Date(String(d)) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(date) : "—";
};

/**
 * Asociar un pago a una suscripción o a un ciclo. Era un formulario con un
 * desplegable metido dentro del menú de la fila.
 */
export default async function AssociatePaymentPage({
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
  const subscriptionId = String(payment.subscriptionId || "").trim();
  const cycles: any[] = Array.isArray(payment.candidateCycles) ? payment.candidateCycles : [];
  const needsCycle = Boolean(subscriptionId) && !payment.billingCycle;

  return (
    <PageShell
      title={needsCycle ? "Asociar pago a un ciclo" : "Asociar pago a una suscripción"}
      subtitle={[who, payment.reference].filter(Boolean).join(" · ") || undefined}
      crumbs={[{ label: "Pagos", href: returnTo }, { label: who || "Pago" }, { label: "Asociar" }]}
      backHref={returnTo}
    >
      <form action={associatePayment} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="paymentId" value={String(payment.id || "")} />
        <input type="hidden" name="tenantId" value={String(payment.tenantId || "")} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {subscriptionId ? <input type="hidden" name="subscriptionId" value={subscriptionId} /> : null}

        <PageSection
          title={needsCycle ? "Ciclo" : "Suscripción"}
          description={needsCycle ? "Elige el ciclo abierto al que corresponde este pago." : "Escribe el ID de la suscripción a la que pertenece este pago."}
        >
          {cycles.length ? (
            <div className="field">
              <label htmlFor="cycleId">Ciclo</label>
              <select id="cycleId" className="select" name="cycleId" defaultValue="" required={!subscriptionId}>
                <option value="">Elige un ciclo…</option>
                {cycles.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    Ciclo {c.cycleNumber} · vence {fmtDate(c.dueAt)} · {fmtDate(c.periodStartAt)} → {fmtDate(c.periodEndAt)}
                  </option>
                ))}
              </select>
            </div>
          ) : subscriptionId ? (
            <p className="muted" style={{ margin: 0 }}>Esta suscripción no tiene ciclos abiertos para asociar.</p>
          ) : (
            <div className="field">
              <label htmlFor="subscriptionId">ID de la suscripción</label>
              <input id="subscriptionId" className="input" name="subscriptionId" placeholder="ID de suscripción" required />
            </div>
          )}
        </PageSection>

        <FormActions cancelHref={returnTo}>
          <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Asociando..." disabled={Boolean(subscriptionId) && !cycles.length}>
            {needsCycle ? "Asociar ciclo" : "Asociar"}
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
