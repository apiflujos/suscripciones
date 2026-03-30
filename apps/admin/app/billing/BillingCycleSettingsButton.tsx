"use client";

type Props = {
  subscriptionId: string;
  tenantId: string;
  csrfToken: string;
  returnTo: string;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  action: (formData: FormData) => void | Promise<void>;
};

export function BillingCycleSettingsButton({
  subscriptionId,
  tenantId,
  csrfToken,
  returnTo,
  cycleStartDay,
  paymentDay,
  paymentTiming,
  graceDays,
  action
}: Props) {
  return (
    <details className="inline-detail billing-cycle-detail">
      <summary className="ghost btn-compact btn-icon-only btn-gear" title="Editar ciclo" aria-label="Editar ciclo">
        <span aria-hidden="true" />
      </summary>
      <div className="inline-detail-body billing-cycle-detail-body">
        <form action={action} className="billing-cycle-form-inline">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="field field-inline">
            <span className="field-hint">Inicio ciclo</span>
            <select className="select select-sm" name="cycleStartDay" defaultValue={String(cycleStartDay || 1)}>
              {Array.from({ length: 31 }).map((_, i) => (
                <option key={`cycle-start-${subscriptionId}-${i + 1}`} value={String(i + 1)}>{i + 1}</option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <span className="field-hint">Día pago</span>
            <select className="select select-sm" name="paymentDay" defaultValue={String(paymentDay || 1)}>
              {Array.from({ length: 31 }).map((_, i) => (
                <option key={`pay-day-${subscriptionId}-${i + 1}`} value={String(i + 1)}>{i + 1}</option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <span className="field-hint">Tipo</span>
            <select className="select select-sm" name="paymentTiming" defaultValue={String(paymentTiming || "EN_CURSO")}>
              <option value="EN_CURSO">En curso</option>
              <option value="ANTICIPADO">Adelantado</option>
            </select>
          </label>
          <label className="field field-inline">
            <span className="field-hint">Gracia</span>
            <select className="select select-sm" name="graceDays" defaultValue={String(graceDays || 1)}>
              {Array.from({ length: 5 }).map((_, i) => (
                <option key={`grace-${subscriptionId}-${i + 1}`} value={String(i + 1)}>{i + 1}</option>
              ))}
            </select>
          </label>
          <button className="ghost btn-compact btn-noicon" type="submit">Guardar</button>
        </form>
      </div>
    </details>
  );
}
