"use client";

import { useState } from "react";
import { HelpTip } from "../ui/HelpTip";

type Props = {
  subscriptionId: string;
  currentPeriodEndAt: string | null;
  nextRetryAt?: string | null;
  csrfToken: string;
  returnTo?: string;
};

export function RetryDateField({
  subscriptionId,
  currentPeriodEndAt,
  nextRetryAt,
  csrfToken,
  returnTo
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  // Priorizar manualRetry sobre autoRetry
  const displayRetryAt = nextRetryAt;
  const [retryLocal, setRetryLocal] = useState(
    displayRetryAt ? toLocalDateTime(new Date(displayRetryAt)) : ""
  );

  // Fallback: si currentPeriodEndAt es null, usar fecha actual (para evitar errores)
  const cutoffDate = currentPeriodEndAt ? new Date(currentPeriodEndAt) : new Date();
  const isPastDue = cutoffDate.getTime() < Date.now();

  function toLocalDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function toIsoFromLocal(value: string): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }

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
        {hasRetryDate && !isEditing ? (
          <button
            type="button"
            className="ghost btn-compact"
            onClick={() => setIsEditing(true)}
            title="Editar fecha de reintento"
          >
            Editar
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="billing-retry-editor">
          <input
            className="input"
            type="datetime-local"
            value={retryLocal}
            onChange={(e) => setRetryLocal(e.target.value)}
            step={60}
          />
          <div className="billing-retry-actions">
            <button
              type="button"
              className="ghost btn-compact"
              onClick={() => {
                setRetryLocal("");
                setIsEditing(false);
              }}
              title="Limpiar fecha"
            >
              Limpiar
            </button>
            <button
              type="button"
              className="primary btn-compact"
              onClick={() => {
                const retryIso = toIsoFromLocal(retryLocal);
                const formData = new FormData();
                formData.append("csrf", csrfToken);
                formData.append("subscriptionId", subscriptionId);
                if (retryIso) {
                  formData.append("nextRetryAt", retryIso);
                }
                if (returnTo) {
                  formData.append("returnTo", returnTo);
                }
                fetch("/api/subscriptions/set-retry-date", {
                  method: "POST",
                  body: formData
                })
                  .then((res) => {
                    if (res.ok) {
                      setIsEditing(false);
                      window.location.reload();
                    }
                  })
                  .catch((err) => {
                    console.error("Error al guardar fecha de reintento:", err);
                    alert("Error al guardar. Intenta de nuevo.");
                  });
              }}
            >
              Guardar
            </button>
          </div>
        </div>
      ) : hasRetryDate ? (
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
