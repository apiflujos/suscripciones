import { PendingButton } from "../ui/PendingButton";
import { FormActions, PageSection } from "../ui/PageShell";
import { reconcilePayment } from "./actions";

export type ReconcileDefaults = {
  paymentId?: string;
  reference?: string;
  wompiTransactionId?: string;
  wompiPaymentLinkId?: string;
  tenantId?: string;
  amountInCents?: number;
  currency?: string;
};

/** Formulario de "Reconciliar pago Wompi" (antes un modal). Componente de servidor. */
export function ReconcileForm({
  csrfToken,
  returnTo,
  defaults = {}
}: {
  csrfToken: string;
  returnTo: string;
  defaults?: ReconcileDefaults;
}) {
  return (
    <form action={reconcilePayment} className="page-shell-body">
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {defaults.tenantId ? <input type="hidden" name="tenantId" value={defaults.tenantId} /> : null}
      {defaults.amountInCents ? <input type="hidden" name="amountInCents" value={String(defaults.amountInCents)} /> : null}
      {defaults.currency ? <input type="hidden" name="currency" value={defaults.currency} /> : null}

      <PageSection
        title="Identificadores del pago"
        description="Ingresa al menos uno: Transacción, Referencia, Payment ID o Link id."
      >
        <div className="field">
          <label htmlFor="rec-tx">Transacción Wompi</label>
          <input id="rec-tx" className="input" name="wompiTransactionId" placeholder="125761-1772468109-43044" defaultValue={defaults.wompiTransactionId || ""} />
        </div>
        <div className="field">
          <label htmlFor="rec-ref">Referencia (opcional)</label>
          <input id="rec-ref" className="input" name="reference" placeholder="SUB_xxx_1" defaultValue={defaults.reference || ""} />
        </div>
        <div className="field">
          <label htmlFor="rec-pid">Payment ID (opcional)</label>
          <input id="rec-pid" className="input" name="paymentId" placeholder="UUID del pago" defaultValue={defaults.paymentId || ""} />
        </div>
        <div className="field">
          <label htmlFor="rec-link">Link id (opcional)</label>
          <input id="rec-link" className="input" name="wompiPaymentLinkId" placeholder="izuz78" defaultValue={defaults.wompiPaymentLinkId || ""} />
        </div>
      </PageSection>

      <FormActions cancelHref={returnTo}>
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Reconciliando..." title="Reconciliar pago con Wompi">
          Reconciliar
        </PendingButton>
      </FormActions>
    </form>
  );
}
