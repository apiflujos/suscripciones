"use client";

import { useMemo, useState } from "react";
import { AppModal } from "../ui/AppModal";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { formatCivilDate } from "./civilDate";

export function SubscriptionEditModal({
  subscriptionId,
  tenantId,
  csrfToken,
  returnTo,
  currentChargeAt,
  periodStartAt,
  currentPlanName,
  planIntervalUnit,
  planIntervalCount,
  cycleStartDay,
  paymentDay,
  paymentTiming,
  graceDays,
  collectionMode,
  updateSubscriptionBillingSettings,
  deleteSubscription,
  globalConfig,
  CyclesModal,
  cyclesTrigger
}: {
  subscriptionId: string;
  tenantId?: string | null;
  csrfToken: string;
  returnTo: string;
  currentChargeAt: string | null;
  periodStartAt: string | null;
  currentPlanId: string;
  currentPlanName: string;
  currentPlanCurrency: string;
  currentShippingInCents: number;
  currentRequiresShipping: boolean;
  planIntervalUnit: string;
  planIntervalCount: number;
  plans: unknown[];
  changeSubscriptionPlan: (formData: FormData) => void;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  collectionMode?: string;
  updateSubscriptionBillingSettings: (formData: FormData) => void | Promise<void>;
  deleteSubscription: (formData: FormData) => void | Promise<void>;
  globalConfig?: {
    graceDays: number;
  };
  CyclesModal?: React.ComponentType<{ subscriptionId: string; csrfToken: string; returnTo: string; tenantId?: string | null }>;
  cyclesTrigger?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subscriptionType, setSubscriptionType] = useState<"AUTO_DEBIT" | "LINK_PAYMENT">(
    collectionMode === "AUTO_DEBIT" ? "AUTO_DEBIT" : "LINK_PAYMENT"
  );
  const [localCycleStartDay, setLocalCycleStartDay] = useState(cycleStartDay || 1);
  const [localPaymentDay, setLocalPaymentDay] = useState(paymentDay || 15);
  const [localPaymentTiming, setLocalPaymentTiming] = useState(String(paymentTiming || "EN_CURSO"));

  // Start date state — editable to regenerate cycles
  const [localStartAt, setLocalStartAt] = useState<string>(() => {
    if (periodStartAt) {
      const d = new Date(periodStartAt);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    return "";
  });

  const toLocalDate = (value?: string | null) => {
    if (!value) return null;
    const datePart = String(value).slice(0, 10);
    const [y, m, d] = datePart.split("-").map((v) => Number(v));
    if (!y || !m || !d) return new Date(value);
    return new Date(y, m - 1, d, 12, 0, 0);
  };

  const nextChargeDate = useMemo(() => toLocalDate(currentChargeAt), [currentChargeAt]);

  const fmtDate = (d: Date | null) => {
    if (!d) return "—";
    const normalized = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    return new Intl.DateTimeFormat("es-CO", { dateStyle: "short" }).format(normalized);
  };

  return (
    <>
      <button
        className="ghost btn-compact btn-icon-only btn-edit"
        type="button"
        title="Editar producto y facturación"
        aria-label="Editar producto y facturación"
        onClick={() => setOpen(true)}
      />

      <AppModal open={open} onClose={() => setOpen(false)} title="Editar producto y facturación" panelClassName="subscription-edit-modal">
        <form action={updateSubscriptionBillingSettings} className="modal-body subscription-edit-modal-body">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <input type="hidden" name="collectionMode" value={subscriptionType === "AUTO_DEBIT" ? "AUTO_DEBIT" : "MANUAL_LINK"} />
              {/* 1. Tipo de suscripción */}
              <section className="card cardPad">
                <div className="subscription-edit-type-row">
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="subscriptionType"
                        checked={subscriptionType === "AUTO_DEBIT"}
                        onChange={() => setSubscriptionType("AUTO_DEBIT")}
                    />
                    <span>Débito automático</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="subscriptionType"
                        checked={subscriptionType === "LINK_PAYMENT"}
                        onChange={() => setSubscriptionType("LINK_PAYMENT")}
                    />
                    <span>Link de pago</span>
                  </label>
                </div>
                <div className="field-hint" style={{ marginTop: "var(--space-2)" }}>
                  Débito automático requiere tarjeta tokenizada
                </div>
              </section>

              {/* 2. Resumen actual */}
              <section className="card cardPad">
                <div style={{ display: "grid", gap: "var(--space-2)" }}>
                  <div className="field-hint">
                    Producto actual: <strong>{currentPlanName}</strong>
                  </div>
                  <div className="field-hint">
                    Periodicidad actual: cada {planIntervalCount} {String(planIntervalUnit || "MONTH").toLowerCase()}
                  </div>
                  <div className="field-hint">
                    Esta pantalla edita reglas de cobro y ciclo. El cambio de producto o periodicidad debe hacerse desde su flujo específico.
                  </div>
                </div>
              </section>

              {/* 3. Configuración de ciclo */}
              <section className="card cardPad">
                <div style={{ display: "grid", gap: "var(--space-3)" }}>
                  {/* Fecha de inicio — editable para regenerar ciclos */}
                  <div className="field">
                    <label className="field-label">
                      Fecha de inicio de la suscripción
                      <HelpTip text="Cambia esta fecha para regenerar los ciclos de cobro desde el nuevo inicio. Se recalcula automáticamente." />
                    </label>
                    <input
                      className="input"
                      type="date"
                      name="startAt"
                      value={localStartAt}
                      onChange={(e) => setLocalStartAt(e.target.value)}
                    />
                    <div className="field-hint">
                      Actual: {formatCivilDate(periodStartAt, "short")}
                    </div>
                  </div>

                  {/* Botón para ver ciclos de facturación */}
                  <div className="field">
                    <label className="field-label">Ciclos de facturación</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {cyclesTrigger ? (
                        <button
                          className="ghost btn-compact"
                          type="button"
                          onClick={cyclesTrigger}
                        >
                          📅 Ver y asociar ciclos
                        </button>
                      ) : null}
                      {CyclesModal ? (
                        <CyclesModal
                          subscriptionId={subscriptionId}
                          csrfToken={csrfToken}
                          returnTo={returnTo}
                          tenantId={tenantId}
                        />
                      ) : null}
                    </div>
                    <div className="field-hint">
                      Revisa los ciclos generados, asocia pagos automáticamente o busca manualmente.
                    </div>
                  </div>

                  <div className="subscription-edit-cycle-grid">
                    <div className="field">
                      <label className="field-label">
                        Día inicio ciclo
                        <HelpTip text="Día del mes en que inicia cada ciclo. Ej: Día 1." />
                      </label>
                      <select
                        className="select"
                        name="cycleStartDay"
                        value={localCycleStartDay}
                        onChange={(e) => setLocalCycleStartDay(Number(e.target.value))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                          <option key={day} value={day}>Día {day}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label className="field-label">
                        Día de cobro
                        <HelpTip text="Día del mes en que se realiza el cobro." />
                      </label>
                      <select
                        className="select"
                        name="paymentDay"
                        value={localPaymentDay}
                        onChange={(e) => setLocalPaymentDay(Number(e.target.value))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                          <option key={day} value={day}>Día {day}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="field">
                    <label className="field-label">
                      Tipo de cobro
                      <HelpTip text="En curso: cobras al final del ciclo. Adelantado: cobras al inicio del ciclo siguiente." />
                    </label>
                    <select
                      className="select"
                      name="paymentTiming"
                      value={localPaymentTiming}
                      onChange={(e) => setLocalPaymentTiming(e.target.value)}
                    >
                      <option value="EN_CURSO">En curso</option>
                      <option value="ANTICIPADO">Adelantado</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">
                      Configuración global de cobro
                      <HelpTip text="Los días de gracia se definen solo en Configuración." />
                    </label>
                    <div className="field-hint">Gracia: {globalConfig?.graceDays ?? graceDays} días.</div>
                  </div>

                  {nextChargeDate && (
                    <div style={{ padding: "var(--space-3)", background: "var(--primary-soft)", borderRadius: "var(--radius-3)" }}>
                      <div style={{ color: "var(--text-soft)", marginBottom: "var(--space-1)" }}>Próximo cobro</div>
                      <div style={{ fontWeight: 700, color: "var(--primary)" }}>{fmtDate(nextChargeDate)}</div>
                      {periodStartAt && (
                        <div style={{ color: "var(--text-faint)", marginTop: "var(--space-1)" }}>
                          Ciclo: {fmtDate(toLocalDate(periodStartAt))} → {fmtDate(nextChargeDate)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* Acciones */}
              <div className="module-footer subscription-edit-footer">
                <button
                  className="ghost btn-compact subscription-edit-footer-btn subscription-edit-cancel-btn"
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton
                  className="primary btn-compact subscription-edit-footer-btn subscription-edit-submit-btn"
                  type="submit"
                  pendingText="Guardando..."
                  title="Guardar cambios en la suscripción"
                  aria-label="Guardar cambios"
                >
                  Guardar
                </PendingButton>
              </div>
        </form>
      </AppModal>
    </>
  );
}

function fmtMoney(currency: string) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(0);
}
