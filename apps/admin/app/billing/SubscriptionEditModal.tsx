"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppModal } from "../ui/AppModal";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { mapPlanFromApi, type PlanOption } from "./ChangePlanButton";
import { formatCivilDate } from "./civilDate";

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
  plans: PlanOption[];
  changeSubscriptionPlan: (formData: FormData) => void;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  suspendDays: number;
  cancelDays: number;
  collectionMode?: string;
  updateSubscriptionBillingSettings: (formData: FormData) => void | Promise<void>;
  deleteSubscription: (formData: FormData) => void | Promise<void>;
  globalConfig?: {
    graceDays: number;
    suspendDays: number;
    cancelDays: number;
  };
  CyclesModal?: React.ComponentType<{ subscriptionId: string; csrfToken: string; returnTo: string; tenantId?: string | null }>;
  cyclesTrigger?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subscriptionType, setSubscriptionType] = useState<"AUTO_DEBIT" | "LINK_PAYMENT">(
    collectionMode === "AUTO_DEBIT" ? "AUTO_DEBIT" : "LINK_PAYMENT"
  );
  const [products, setProducts] = useState<SubscriptionProduct[]>([]);
  const [intervalCount, setIntervalCount] = useState(Number(planIntervalCount || 1));
  const [intervalUnit, setIntervalUnit] = useState(String(planIntervalUnit || "MONTH"));
  const [localCycleStartDay, setLocalCycleStartDay] = useState(cycleStartDay || 1);
  const [localPaymentDay, setLocalPaymentDay] = useState(paymentDay || 15);
  const [localPaymentTiming, setLocalPaymentTiming] = useState(String(paymentTiming || "EN_CURSO"));
  const [shippingCop, setShippingCop] = useState("");
  const [freeShipping, setFreeShipping] = useState(!currentRequiresShipping || currentShippingInCents <= 0);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<PlanOption[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [productSearchError, setProductSearchError] = useState("");

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

  const searchProducts = useCallback(async (query: string, signal?: AbortSignal) => {
    const trimmed = query.trim();

    setProductSearchLoading(true);
    setProductSearchError("");
    try {
      const qs = new URLSearchParams({ q: trimmed, take: "10" });
      if (tenantId) qs.set("tenantId", tenantId);
      const res = await fetch(`/api/search/products?${qs.toString()}`, { cache: "no-store", signal });
      if (!res.ok) {
        setProductSearchResults([]);
        setProductSearchError(`Error buscando productos (${res.status}).`);
        return;
      }
      const json = await res.json().catch(() => ({ items: [] }));
      const items = Array.isArray(json.items) ? json.items : [];
      const existingProductIds = new Set(products.map((product) => String(product.productId)));
      const mapped = items
        .map((item) => mapPlanFromApi(item))
        .filter((item) => item.id && !existingProductIds.has(String(item.id)));
      setProductSearchResults(mapped);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setProductSearchResults([]);
      setProductSearchError("Error de red buscando productos.");
    } finally {
      if (!signal?.aborted) {
        setProductSearchLoading(false);
      }
    }
  }, [products, tenantId]);

  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      if (productSearchOpen) {
        void searchProducts(productSearchQuery, ac.signal);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [productSearchOpen, productSearchQuery, searchProducts]);

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

              {/* 2. Productos */}
              <section className="card cardPad">
                <div className="subscription-edit-products-list">
                  {products.map((product) => (
                    <div key={product.id} className="customer-search-item subscription-edit-product-row">
                      <div className="subscription-edit-product-meta">
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
                    <div className="field-hint">No hay productos adicionales configurados</div>
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
                    <div aria-live="polite">
                      {productSearchLoading ? <div className="muted">Buscando...</div> : null}
                      {productSearchError ? <div className="field-hint subscription-edit-search-error">{productSearchError}</div> : null}
                    </div>
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
                            <span className="muted subscription-edit-plan-price">{new Intl.NumberFormat("es-CO", { style: "currency", currency: product.currency || "COP", maximumFractionDigits: 0 }).format(Number(product.priceInCents || 0) / 100)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!productSearchLoading && !productSearchError && productSearchResults.length === 0 ? (
                      <div className="field-hint">{productSearchQuery.trim() ? "Sin resultados. Prueba con otro término." : "No hay productos activos disponibles."}</div>
                    ) : null}
                  </div>
                ) : (
                  <button className="primary btn-compact subscription-edit-add-product-btn" type="button" onClick={() => setProductSearchOpen(true)}>
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
                      <HelpTip text="Los días de gracia, suspensión y cancelación se definen solo en Configuración." />
                    </label>
                    <div className="field-hint">Gracia: {globalConfig?.graceDays ?? graceDays} días.</div>
                    <div className="field-hint">Suspender: {globalConfig?.suspendDays ?? suspendDays} días.</div>
                    <div className="field-hint">Cancelar: {globalConfig?.cancelDays ?? cancelDays} días.</div>
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
