"use client";

import { useState } from "react";
import { LocalDateTime } from "../ui/LocalDateTime";
import { HelpTip } from "../ui/HelpTip";
import { AppModal } from "../ui/AppModal";

type Props = {
  subscriptionId: string;
  currentChargeAt: string | null;
  periodStartAt: string | null;
  intervalUnit: string;
  intervalCount: number;
  csrfToken: string;
  returnTo: string;
  action: (formData: FormData) => Promise<void>;
};

export function EditBillingDateModal({
  subscriptionId,
  currentChargeAt,
  periodStartAt,
  intervalUnit,
  intervalCount,
  csrfToken,
  returnTo,
  action
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calcular valor inicial para el input date
  const initialDateValue = currentChargeAt
    ? new Date(currentChargeAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const initialTimeValue = currentChargeAt
    ? new Date(currentChargeAt).toTimeString().slice(0, 5)
    : "10:00";

  const [dateValue, setDateValue] = useState(initialDateValue);
  const [timeValue, setTimeValue] = useState(initialTimeValue);

  const handleOpen = () => {
    setDateValue(initialDateValue);
    setTimeValue(initialTimeValue);
    setOpen(true);
    setError(null);
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
  };

  const handleSave = async () => {
    setPending(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("csrf", csrfToken);
      formData.set("subscriptionId", subscriptionId);
      formData.set("chargeDate", dateValue);
      formData.set("chargeTime", timeValue);
      if (returnTo) formData.set("returnTo", returnTo);

      await action(formData);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setPending(false);
    }
  };

  // Calcular fechas del ciclo
  const chargeDate = currentChargeAt ? new Date(currentChargeAt) : null;
  const start = periodStartAt ? new Date(periodStartAt) : null;
  
  const fmtDate = (d: Date | null) => {
    if (!d) return "—";
    return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(d);
  };

  return (
    <>
      <button
        className="ghost btn-compact"
        type="button"
        onClick={handleOpen}
        disabled={pending}
        title="Editar fecha de cobro"
      >
        Editar
      </button>

      <AppModal
        open={open}
        onClose={handleClose}
        title="Editar fecha de cobro"
        width="min(560px, 96vw)"
        bodyClassName=""
      >
        <div style={{ padding: "16px 0" }}>
              <div className="field">
                <label>
                  Fecha de cobro
                  <HelpTip text="Esta es la fecha cuando se realizará el cobro de la suscripción. El ciclo se calcula automáticamente hacia atrás según la periodicidad del plan." />
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="date"
                    className="input"
                    value={dateValue}
                    onChange={(e) => setDateValue(e.target.value)}
                    disabled={pending}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="time"
                    className="input"
                    value={timeValue}
                    onChange={(e) => setTimeValue(e.target.value)}
                    disabled={pending}
                    style={{ width: "100px" }}
                  />
                </div>
              </div>

              {chargeDate && start && (
                <div
                  className="field"
                  style={{
                    padding: "12px",
                    background: "var(--bg-subtle, #f5f5f5)",
                    borderRadius: "6px",
                    fontSize: "13px"
                  }}
                >
                  <div style={{ marginBottom: "8px", fontWeight: 500 }}>Información del ciclo</div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    <div>
                      <span style={{ color: "var(--muted)" }}>Ciclo actual:</span>{" "}
                      <strong>{fmtDate(start)} → {fmtDate(chargeDate)}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)" }}>Periodicidad:</span>{" "}
                      <strong>
                        {intervalCount} {intervalUnit === "MONTH" ? "mes(es)" : intervalUnit === "WEEK" ? "semana(s)" : "día(s)"}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--muted)" }}>Próximo ciclo:</span>{" "}
                      <strong>{fmtDate(chargeDate)} → {fmtDate(new Date(chargeDate.getTime() + (intervalUnit === "MONTH" ? 30 : intervalUnit === "WEEK" ? 7 : 1) * intervalCount * 24 * 60 * 60 * 1000))}</strong>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div
                  style={{
                    color: "var(--error, #d32f2f)",
                    fontSize: "13px",
                    marginTop: "12px",
                    padding: "8px",
                    background: "var(--error-bg, #ffebee)",
                    borderRadius: "4px"
                  }}
                >
                  {error}
                </div>
              )}
        </div>

        <div className="module-footer">
          <button
            className="ghost btn-compact btn-cancel"
            type="button"
            onClick={handleClose}
            disabled={pending}
            title="Cerrar sin guardar"
            aria-label="Cancelar"
          >
            Cancelar
          </button>
          <button
            className="primary btn-compact btn-save"
            type="button"
            onClick={handleSave}
            disabled={pending}
            title="Guardar fecha de cobro"
            aria-label="Guardar cambios"
          >
            {pending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </AppModal>
    </>
  );
}
