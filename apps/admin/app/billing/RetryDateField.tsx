"use client";

import { HelpTip } from "../ui/HelpTip";

type Props = {
  subscriptionId: string;
  currentPeriodEndAt: string | null;
  nextRetryAt?: string | null;
  csrfToken: string;
  returnTo?: string;
};

export function RetryDateField({
  currentPeriodEndAt,
  nextRetryAt
}: Props) {
  // Priorizar manualRetry sobre autoRetry
  const displayRetryAt = nextRetryAt;

  // Fallback: si currentPeriodEndAt es null, usar fecha actual (para evitar errores)
  const cutoffDate = currentPeriodEndAt ? new Date(currentPeriodEndAt) : new Date();
  const isPastDue = cutoffDate.getTime() < Date.now();

  const hasRetryDate = Boolean(nextRetryAt);

  return (
    <div className="field billing-retry-field">
      <div className="billing-retry-header">
        <label className="billing-retry-label">
          <span>Fecha de reintento</span>
          <HelpTip 
            text={
              isPastDue
                ? "Fecha programada para el próximo intento de cobro automático.\nSe muestra cuando la fecha de corte ya pasó y el pago está pendiente."
                : "La fecha de reintento se mostrará cuando la suscripción venza."
            }
          />
        </label>
      </div>

      {hasRetryDate ? (
        <span className="billing-retry-date billing-value">
          {displayRetryAt ? new Date(displayRetryAt).toLocaleString() : "—"}
        </span>
      ) : isPastDue ? (
        <span className="billing-retry-status is-overdue">
          Pago vencido
        </span>
      ) : (
        <span className="billing-retry-status is-ok">
          Al día
        </span>
      )}

      {cutoffDate && false && (
        <div className="field-hint" style={{ fontSize: "0.85em", opacity: 0.8 }}>
          Corte: {cutoffDate.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })} {isPastDue ? "(vencida)" : ""}
        </div>
      )}
    </div>
  );
}
