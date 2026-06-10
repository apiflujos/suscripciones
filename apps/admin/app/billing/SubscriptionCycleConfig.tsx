"use client";

import { HelpTip } from "../ui/HelpTip";

export function SubscriptionCycleConfig({
  cycleStartDay,
  paymentDay,
  useGlobalConfig,
  graceDays,
  onCycleStartDayChange,
  onPaymentDayChange,
  onUseGlobalConfigChange,
  onGraceDaysChange,
  nextChargeDate,
  periodStartAt
}: {
  cycleStartDay: number;
  paymentDay: number;
  useGlobalConfig: boolean;
  graceDays: number;
  onCycleStartDayChange: (day: number) => void;
  onPaymentDayChange: (day: number) => void;
  onUseGlobalConfigChange: (use: boolean) => void;
  onGraceDaysChange: (days: number) => void;
  nextChargeDate?: Date | null;
  periodStartAt?: string | null;
}) {
  const toLocalDate = (value?: string | null) => {
    if (!value) return null;
    const datePart = String(value).slice(0, 10);
    const [y, m, d] = datePart.split("-").map((v) => Number(v));
    if (!y || !m || !d) return new Date(value);
    return new Date(y, m - 1, d, 12, 0, 0);
  };

  const fmtDate = (d: Date | string | null) => {
    if (!d) return "—";
    const date =
      typeof d === "string"
        ? toLocalDate(d)
        : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    if (!(date instanceof Date)) return "—";
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-CO", { dateStyle: "short" }).format(date);
  };

  return (
    <div className="panel module" style={{ margin: 0 }}>
      <div className="panel-header">
        <h3 style={{ margin: 0 }}>5) Configuración de ciclo</h3>
      </div>
      <div style={{ display: "grid", gap: 16, padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label className="field-label">
              Día inicio ciclo
              <HelpTip text="Día del mes cuando inicia el ciclo de facturación" />
            </label>
            <select
              className="select"
              value={cycleStartDay}
              onChange={(e) => onCycleStartDayChange(Number(e.target.value))}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>Día {day}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">
              Día de cobro
              <HelpTip text="Día del mes cuando se realiza el cobro" />
            </label>
            <select
              className="select"
              value={paymentDay}
              onChange={(e) => onPaymentDayChange(Number(e.target.value))}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>Día {day}</option>
              ))}
            </select>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={useGlobalConfig}
            onChange={(e) => onUseGlobalConfigChange(e.target.checked)}
          />
          <span>Usar configuración global de días de gracia</span>
        </label>

        {!useGlobalConfig && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, padding: 12, background: "var(--panel-soft)", borderRadius: 8 }}>
            <div className="field">
              <label className="field-label">Días de gracia</label>
              <select
                className="select"
                value={graceDays}
                onChange={(e) => onGraceDaysChange(Number(e.target.value))}
              >
                {Array.from({ length: 16 }, (_, i) => i).map((days) => (
                  <option key={days} value={days}>{days} días</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {nextChargeDate && (
          <div style={{ padding: 12, background: "var(--primary-soft)", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 4 }}>Primer cobro</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--primary)" }}>{fmtDate(nextChargeDate)}</div>
            {periodStartAt && (
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                Ciclo: {fmtDate(periodStartAt)} → {fmtDate(nextChargeDate)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
