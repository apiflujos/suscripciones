"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import type { PlanOption } from "./ChangePlanButton";

type SubscriptionProduct = {
  id: string;
  productId: string;
  name: string;
  priceInCents: number;
  currency: string;
  requiresShipping: boolean;
  quantity: number;
};

export function SubscriptionEditModal({
  subscriptionId,
  tenantId,
  csrfToken,
  returnTo,
  currentChargeAt,
  periodStartAt,
  currentPlanId,
  currentPlanName,
  currentPlanCurrency,
  currentShippingInCents,
  currentRequiresShipping,
  planIntervalUnit,
  planIntervalCount,
  plans,
  changeSubscriptionPlan,
  cycleStartDay,
  paymentDay,
  paymentTiming,
  graceDays,
  suspendDays,
  cancelDays,
  updateSubscriptionBillingSettings,
  deleteSubscription,
  globalConfig
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
  plans: PlanOption[];
  changeSubscriptionPlan: (formData: FormData) => void;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  suspendDays: number;
  cancelDays: number;
  updateSubscriptionBillingSettings: (formData: FormData) => void | Promise<void>;
  deleteSubscription: (formData: FormData) => void | Promise<void>;
  globalConfig?: {
    graceDays: number;
    suspendDays: number;
    cancelDays: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [subscriptionType, setSubscriptionType] = useState<"AUTO_DEBIT" | "LINK_PAYMENT">("AUTO_DEBIT");
  const [products, setProducts] = useState<SubscriptionProduct[]>([]);
  const [intervalCount, setIntervalCount] = useState(Number(planIntervalCount || 1));
  const [intervalUnit, setIntervalUnit] = useState(String(planIntervalUnit || "MONTH"));
  const [localCycleStartDay, setLocalCycleStartDay] = useState(cycleStartDay || 1);
  const [localPaymentDay, setLocalPaymentDay] = useState(paymentDay || 15);
  const [localPaymentTiming, setLocalPaymentTiming] = useState(String(paymentTiming || "EN_CURSO"));
  const [useGlobalConfig, setUseGlobalConfig] = useState(true);
  const [localGraceDays, setLocalGraceDays] = useState(graceDays || 5);
  const [localSuspendDays, setLocalSuspendDays] = useState(suspendDays || 15);
  const [localCancelDays, setLocalCancelDays] = useState(cancelDays || 30);
  const [shippingCop, setShippingCop] = useState("");
  const [freeShipping, setFreeShipping] = useState(!currentRequiresShipping || currentShippingInCents <= 0);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<PlanOption[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShippingCop(currentShippingInCents > 0 ? (currentShippingInCents / 100).toString() : "0");
    setFreeShipping(!currentRequiresShipping || currentShippingInCents <= 0);
  }, [open, currentShippingInCents, currentRequiresShipping]);

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

  const handleSave = async () => {
    const formData = new FormData();
    formData.set("csrf", csrfToken);
    formData.set("subscriptionId", subscriptionId);
    formData.set("subscriptionType", subscriptionType);
    formData.set("intervalCount", intervalCount.toString());
    formData.set("intervalUnit", intervalUnit);
    formData.set("cycleStartDay", localCycleStartDay.toString());
    formData.set("paymentDay", localPaymentDay.toString());
    formData.set("paymentTiming", localPaymentTiming);
    formData.set("useGlobalConfig", useGlobalConfig ? "1" : "0");
    if (!useGlobalConfig) {
      formData.set("graceDays", localGraceDays.toString());
      formData.set("suspendDays", localSuspendDays.toString());
      formData.set("cancelDays", localCancelDays.toString());
    }
    formData.set("shippingPesos", freeShipping ? "0" : shippingCop);
    formData.set("freeShipping", freeShipping ? "1" : "0");
    if (returnTo) formData.set("returnTo", returnTo);

    await updateSubscriptionBillingSettings(formData);
    setOpen(false);
  };

  const searchProducts = useCallback(async (query: string) => {
    if (!query.trim()) {
      setProductSearchResults([]);
      return;
    }
    setProductSearchLoading(true);
    try {
      const res = await fetch(`/api/search/products?q=${encodeURIComponent(query)}&take=10`);
      const json = await res.json().catch(() => ({ items: [] }));
      setProductSearchResults(Array.isArray(json.items) ? json.items : []);
    } catch {
      setProductSearchResults([]);
    } finally {
      setProductSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (productSearchQuery) {
        searchProducts(productSearchQuery);
      } else {
        setProductSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearchQuery, searchProducts]);

  const addProduct = (product: PlanOption) => {
    setProducts((prev) => [...prev, {
      id: `prod-${Date.now()}`,
      productId: String(product.id),
      name: String(product.name),
      priceInCents: Number(product.priceInCents || 0),
      currency: String(product.currency || "COP"),
      requiresShipping: Boolean(product.requiresShipping),
      quantity: 1
    }]);
    setProductSearchOpen(false);
    setProductSearchQuery("");
  };

  const removeProduct = (productId: string) => {
    setProducts((prev) => prev.filter((p) => p.productId !== productId));
  };

  return (
    <>
      <button
        className="ghost btn-compact btn-icon-only btn-edit"
        type="button"
        title="Editar suscripción"
        aria-label="Editar suscripción"
        onClick={() => setOpen(true)}
      />

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel subscription-edit-modal" style={{ width: "min(900px, 96vw)" }}>
            <div className="panel-header" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Editar suscripción</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>

            <div className="modal-body" style={{ display: "grid", gap: 16 }}>
              {/* 1. Tipo de suscripción */}
              <section className="card cardPad" style={{ padding: "12px" }}>
                <div style={{ display: "flex", gap: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="subscriptionType"
                      checked={subscriptionType === "AUTO_DEBIT"}
                      onChange={() => setSubscriptionType("AUTO_DEBIT")}
                    />
                    <span>Débito automático</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="subscriptionType"
                      checked={subscriptionType === "LINK_PAYMENT"}
                      onChange={() => setSubscriptionType("LINK_PAYMENT")}
                    />
                    <span>Link de pago</span>
                  </label>
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Débito automático requiere tarjeta tokenizada
                </div>
              </section>

              {/* 2. Productos */}
              <section className="card cardPad" style={{ padding: "12px" }}>
                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  {products.map((product) => (
                    <div key={product.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", border: "1px solid var(--stroke)", borderRadius: 8 }}>
                      <div>
                        <strong>{product.name}</strong>
                        <div className="muted" style={{ fontSize: 11 }}>{new Intl.NumberFormat("es-CO", { style: "currency", currency: product.currency, maximumFractionDigits: 0 }).format(product.priceInCents / 100)}</div>
                      </div>
                      <button
                        className="ghost btn-compact btn-icon-only btn-cancel"
                        type="button"
                        title="Quitar"
                        aria-label="Quitar producto"
                        onClick={() => removeProduct(product.productId)}
                      />
                    </div>
                  ))}
                  {products.length === 0 && (
                    <div className="muted" style={{ fontSize: 12, padding: "8px" }}>No hay productos adicionales</div>
                  )}
                </div>
                
                {productSearchOpen ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="input"
                        type="search"
                        placeholder="Buscar producto..."
                        value={productSearchQuery}
                        onChange={(e) => setProductSearchQuery(e.target.value)}
                        autoFocus
                        style={{ flex: 1 }}
                      />
                      <button className="ghost btn-compact" type="button" onClick={() => setProductSearchOpen(false)}>
                        Cerrar
                      </button>
                    </div>
                    {productSearchLoading && <div className="muted">Buscando...</div>}
                    {productSearchResults.length > 0 && (
                      <div style={{ display: "grid", gap: 4, maxHeight: 200, overflow: "auto" }}>
                        {productSearchResults.map((product) => (
                          <button
                            key={product.id}
                            className="ghost btn-compact"
                            type="button"
                            onClick={() => addProduct(product)}
                            style={{ justifyContent: "space-between", textAlign: "left" }}
                          >
                            <span>{product.name}</span>
                            <span className="muted">{new Intl.NumberFormat("es-CO", { style: "currency", currency: product.currency || "COP", maximumFractionDigits: 0 }).format(Number(product.priceInCents || 0) / 100)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button className="primary btn-compact" type="button" onClick={() => setProductSearchOpen(true)} style={{ whiteSpace: "nowrap", width: "fit-content" }}>
                    Agregar producto
                  </button>
                )}
              </section>

              {/* 3. Periodicidad */}
              <section className="card cardPad" style={{ padding: "12px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>
                    Cobrar cada
                    <HelpTip text="Define la periodicidad del ciclo (ej. cada 1 mes, cada 2 semanas)." />
                  </span>
                  <select
                    className="select select-compact"
                    value={intervalCount}
                    onChange={(e) => setIntervalCount(Number(e.target.value))}
                    style={{ width: 80 }}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="6">6</option>
                    <option value="12">12</option>
                  </select>
                  <select
                    className="select select-compact"
                    value={intervalUnit}
                    onChange={(e) => setIntervalUnit(e.target.value)}
                    style={{ width: 100 }}
                  >
                    <option value="DAY">día(s)</option>
                    <option value="WEEK">semana(s)</option>
                    <option value="MONTH">mes(es)</option>
                    <option value="YEAR">año(s)</option>
                  </select>
                </div>
              </section>

              {/* 4. Configuración de ciclo */}
              <section className="card cardPad" style={{ padding: "12px" }}>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="field">
                      <label className="field-label">
                        Día inicio ciclo
                        <HelpTip text="Día del mes en que inicia cada ciclo. Ej: Día 1." />
                      </label>
                      <select
                        className="select"
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
                      value={localPaymentTiming}
                      onChange={(e) => setLocalPaymentTiming(e.target.value)}
                    >
                      <option value="EN_CURSO">En curso</option>
                      <option value="ANTICIPADO">Adelantado</option>
                    </select>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={useGlobalConfig}
                      onChange={(e) => setUseGlobalConfig(e.target.checked)}
                    />
                    <span>Usar configuración global (días de gracia, suspensión, cancelación)</span>
                  </label>

                  {!useGlobalConfig && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, padding: 12, background: "var(--panel-soft)", borderRadius: 8 }}>
                      <div className="field">
                        <label className="field-label">Días de gracia</label>
                        <select
                          className="select"
                          value={localGraceDays}
                          onChange={(e) => setLocalGraceDays(Number(e.target.value))}
                        >
                          {Array.from({ length: 16 }, (_, i) => i).map((days) => (
                            <option key={days} value={days}>{days} días</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label className="field-label">Suspender después de</label>
                        <select
                          className="select"
                          value={localSuspendDays}
                          onChange={(e) => setLocalSuspendDays(Number(e.target.value))}
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 15).map((days) => (
                            <option key={days} value={days}>{days} días</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label className="field-label">Cancelar después de</label>
                        <select
                          className="select"
                          value={localCancelDays}
                          onChange={(e) => setLocalCancelDays(Number(e.target.value))}
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 30).map((days) => (
                            <option key={days} value={days}>{days} días</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {nextChargeDate && (
                    <div style={{ padding: 12, background: "var(--primary-soft)", borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 4 }}>Próximo cobro</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--primary)" }}>{fmtDate(nextChargeDate)}</div>
                      {periodStartAt && (
                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                          Ciclo: {fmtDate(toLocalDate(periodStartAt))} → {fmtDate(nextChargeDate)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* Acciones */}
              <div className="module-footer">
                <button
                  className="ghost btn-compact btn-cancel"
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                  style={{ whiteSpace: "nowrap", width: "fit-content" }}
                >
                  Cancelar
                </button>
                <PendingButton
                  className="primary btn-compact btn-save"
                  type="button"
                  pendingText="Guardando..."
                  onClick={handleSave}
                  title="Guardar cambios en la suscripción"
                  aria-label="Guardar cambios"
                  style={{ whiteSpace: "nowrap", width: "fit-content" }}
                >
                  Guardar
                </PendingButton>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function fmtMoney(currency: string) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(0);
}
