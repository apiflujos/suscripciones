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

  const effectiveGraceDays = useGlobalConfig ? (globalConfig?.graceDays ?? graceDays) : localGraceDays;

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
          <div className="modal-panel subscription-edit-modal">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Editar suscripción</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>

            <form action={updateSubscriptionBillingSettings} className="modal-body subscription-edit-modal-body">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <input type="hidden" name="graceDays" value={String(effectiveGraceDays)} />
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

              {/* 2. Productos */}
              <section className="card cardPad">
                <div style={{ display: "grid", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                  {products.map((product) => (
                    <div key={product.id} className="customer-search-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <strong>{product.name}</strong>
                        <div className="muted">{new Intl.NumberFormat("es-CO", { style: "currency", currency: product.currency, maximumFractionDigits: 0 }).format(product.priceInCents / 100)}</div>
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
                    <div className="field-hint">No hay productos adicionales</div>
                  )}
                </div>
                
                {productSearchOpen ? (
                  <div className="subscription-product-search">
                  <div className="subscription-product-search-row">
                      <input
                        className="input subscription-product-search-input"
                        type="search"
                        placeholder="Buscar producto..."
                        value={productSearchQuery}
                        onChange={(e) => setProductSearchQuery(e.target.value)}
                        autoFocus
                      />
                      <button className="ghost btn-compact btn-icon-only btn-cancel" type="button" onClick={() => setProductSearchOpen(false)} aria-label="Cerrar búsqueda" title="Cerrar búsqueda" />
                    </div>
                    {productSearchLoading && <div className="muted">Buscando...</div>}
                    {productSearchResults.length > 0 && (
                      <div className="plan-option-list">
                        {productSearchResults.map((product) => (
                          <button
                            key={product.id}
                            className="ghost btn-compact btn-noicon plan-option-item"
                            type="button"
                            onClick={() => addProduct(product)}
                          >
                            <span>{product.name}</span>
                            <span className="muted">{new Intl.NumberFormat("es-CO", { style: "currency", currency: product.currency || "COP", maximumFractionDigits: 0 }).format(Number(product.priceInCents || 0) / 100)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button className="primary btn-compact" type="button" onClick={() => setProductSearchOpen(true)}>
                    Agregar producto
                  </button>
                )}
              </section>

              {/* 3. Periodicidad */}
              <section className="card cardPad">
                <div className="subscription-edit-frequency-row">
                  <span className="subscription-edit-frequency-label">
                    Cobrar cada
                    <HelpTip text="Define la periodicidad del ciclo (ej. cada 1 mes, cada 2 semanas)." />
                  </span>
                  <select
                    className="select select-compact"
                    name="intervalCount"
                    value={intervalCount}
                    onChange={(e) => setIntervalCount(Number(e.target.value))}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="6">6</option>
                    <option value="12">12</option>
                  </select>
                  <select
                    className="select select-compact"
                    name="intervalUnit"
                    value={intervalUnit}
                    onChange={(e) => setIntervalUnit(e.target.value)}
                  >
                    <option value="DAY">día(s)</option>
                    <option value="WEEK">semana(s)</option>
                    <option value="MONTH">mes(es)</option>
                    <option value="YEAR">año(s)</option>
                  </select>
                </div>
              </section>

              {/* 4. Configuración de ciclo */}
              <section className="card cardPad">
                <div style={{ display: "grid", gap: "var(--space-3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
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

                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input
                      type="checkbox"
                      checked={useGlobalConfig}
                      onChange={(e) => setUseGlobalConfig(e.target.checked)}
                    />
                    <span>Usar configuración global (días de gracia, suspensión, cancelación)</span>
                  </label>

                  {!useGlobalConfig && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)", padding: "var(--space-3)", background: "var(--panel-soft)", borderRadius: "var(--radius-3)" }}>
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
                  className="ghost btn-compact btn-cancel"
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Cerrar sin guardar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton
                  className="primary btn-compact btn-save"
                  type="submit"
                  pendingText="Guardando..."
                  title="Guardar cambios en la suscripción"
                  aria-label="Guardar cambios"
                >
                  Guardar
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function fmtMoney(currency: string) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(0);
}
