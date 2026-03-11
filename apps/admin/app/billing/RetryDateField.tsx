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
  const [retryLocal, setRetryLocal] = useState(
    nextRetryAt ? toLocalDateTime(new Date(nextRetryAt)) : ""
  );

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

  const cutoffDate = currentPeriodEndAt ? new Date(currentPeriodEndAt) : null;
  const now = new Date();
  const isPastDue = cutoffDate ? cutoffDate.getTime() < now.getTime() : false;
  const hasRetryDate = Boolean(nextRetryAt);

  return (
    <div className="field" style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
            ✏️
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end" }}>
          <input
            className="input"
            type="datetime-local"
            value={retryLocal}
            onChange={(e) => setRetryLocal(e.target.value)}
            step={60}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="ghost btn-compact"
              onClick={() => {
                setRetryLocal("");
                setIsEditing(false);
              }}
              title="Limpiar fecha"
            >
              🗑️
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
        <div className="input" style={{ fontWeight: 500 }}>
          {nextRetryAt ? new Date(nextRetryAt).toLocaleString() : "—"}
        </div>
      ) : isPastDue ? (
        <div className="field-hint" style={{ color: "var(--warning)" }}>
          ⚠️ Sin fecha de reintento programada (pago vencido)
        </div>
      ) : (
        <div className="field-hint">
          — (al día)
        </div>
      )}

      {cutoffDate && (
        <div className="field-hint" style={{ fontSize: "0.85em", opacity: 0.8 }}>
          📅 Corte: {cutoffDate.toLocaleString()} {isPastDue ? "(vencida)" : ""}
        </div>
      )}
    </div>
  );
}
