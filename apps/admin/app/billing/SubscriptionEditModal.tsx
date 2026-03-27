"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import type { PlanOption } from "./ChangePlanButton";

function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

function mapPlanFromApi(p: any): PlanOption {
  const metadata = p?.metadata && typeof p.metadata === "object" ? p.metadata : {};
  const catalog = metadata?.catalog && typeof metadata.catalog === "object" ? metadata.catalog : {};
  const pricing = readPlanPricing(metadata);
  const kindRaw = String(p?.kind || catalog?.kind || "").toUpperCase();
  const kind = kindRaw === "SERVICE" ? "SERVICE" : "PRODUCT";
  const requiresShippingRaw = p?.requiresShipping ?? catalog?.requiresShipping;
  return {
    id: String(p?.id || ""),
    name: String(metadata?.displayName || p?.name || "Plan"),
    sku: String(p?.sku || metadata?.sku || ""),
    searchText: [metadata?.displayName, p?.name, p?.sku, metadata?.sku, catalog?.name, p?.id]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    collectionMode: String(p?.collectionMode || metadata?.collectionMode || ""),
    priceInCents: Number(p?.priceInCents || p?.basePriceInCents || 0),
    currency: String(p?.currency || "COP"),
    kind,
    requiresShipping: kind === "PRODUCT" && (requiresShippingRaw === true || requiresShippingRaw == null),
    shippingInCents: Number(p?.shippingInCents || pricing?.shippingInCents || 0)
  };
}

function centsToCurrencyInput(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(major) || major <= 0) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(major);
}

function currencyInputToCents(input: string) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value) * 100;
}

function formatCurrencyInput(input: string, currency: string) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function planRequiresShipping(plan: PlanOption | null | undefined) {
  if (!plan) return false;
  const kind = String(plan.kind || "").toUpperCase();
  return kind !== "SERVICE";
}

export function SubscriptionEditModal({
  subscriptionId,
  tenantId,
  csrfToken,
  returnTo,
  currentChargeAt,
  periodStartAt,
  intervalUnit,
  intervalCount,
  setBillingChargeDate,
  currentPlanId,
  currentPlanName,
  currentPlanCurrency,
  currentShippingInCents,
  currentRequiresShipping,
  plans,
  changeSubscriptionPlan,
  cycleStartDay,
  paymentDay,
  paymentTiming,
  graceDays,
  updateSubscriptionBillingSettings,
  deleteSubscription
}: {
  subscriptionId: string;
  tenantId?: string | null;
  csrfToken: string;
  returnTo: string;
  currentChargeAt: string | null;
  periodStartAt: string | null;
  intervalUnit: string;
  intervalCount: number;
  setBillingChargeDate: (formData: FormData) => Promise<void>;
  currentPlanId: string;
  currentPlanName: string;
  currentPlanCurrency: string;
  currentShippingInCents: number;
  currentRequiresShipping: boolean;
  plans: PlanOption[];
  changeSubscriptionPlan: (formData: FormData) => void;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  updateSubscriptionBillingSettings: (formData: FormData) => void | Promise<void>;
  deleteSubscription: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState(currentChargeAt ? new Date(currentChargeAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [timeValue, setTimeValue] = useState(currentChargeAt ? new Date(currentChargeAt).toTimeString().slice(0, 5) : "10:00");
  const [pendingBillingDate, setPendingBillingDate] = useState(false);
  const [billingDateError, setBillingDateError] = useState<string | null>(null);

  const resolvedPlanId = String(currentPlanId || plans?.[0]?.id || "");
  const [planId, setPlanId] = useState(resolvedPlanId);
  const [query, setQuery] = useState("");
  const [shippingCop, setShippingCop] = useState(centsToCurrencyInput(currentShippingInCents || 0, "COP"));
  const [freeShipping, setFreeShipping] = useState(Boolean(currentRequiresShipping) && Number(currentShippingInCents || 0) <= 0);
  const [remotePlans, setRemotePlans] = useState<PlanOption[]>([]);
  const [searching, setSearching] = useState(false);
  const appliedDefaultsPlanIdRef = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    setDateValue(currentChargeAt ? new Date(currentChargeAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    setTimeValue(currentChargeAt ? new Date(currentChargeAt).toTimeString().slice(0, 5) : "10:00");
    setPlanId(resolvedPlanId);
    setQuery("");
    setShippingCop(centsToCurrencyInput(currentShippingInCents || 0, currentPlanCurrency || "COP"));
    setFreeShipping(Boolean(currentRequiresShipping) && Number(currentShippingInCents || 0) <= 0);
    appliedDefaultsPlanIdRef.current = String(resolvedPlanId || "");
    setBillingDateError(null);
  }, [open, currentChargeAt, resolvedPlanId, currentShippingInCents, currentRequiresShipping, currentPlanCurrency]);

  const localFilteredPlans = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) => {
      const name = String(p.name || "").toLowerCase();
      const id = String(p.id || "").toLowerCase();
      const sku = String(p.sku || "").toLowerCase();
      const search = String(p.searchText || "").toLowerCase();
      return name.includes(q) || id.includes(q) || sku.includes(q) || search.includes(q);
    });
  }, [plans, query]);

  const fetchPlans = useCallback(async (qRaw: string) => {
    const q = String(qRaw || "").trim();
    setSearching(true);
    try {
      const fetchBatch = async (opts: { scopedTenant: boolean }) => {
        const qs = new URLSearchParams();
        qs.set("take", "2000");
        if (q) qs.set("q", q);
        if (tenantId && opts.scopedTenant) qs.set("tenantId", tenantId);
        qs.set("_ts", String(Date.now()));
        const res = await fetch(`/api/search/products?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) return [] as any[];
        const json = await res.json().catch(() => null);
        return Array.isArray(json?.items) ? json.items : [];
      };
      const scopedItems = await fetchBatch({ scopedTenant: true });
      const shouldTryGlobal = Boolean(tenantId) && scopedItems.length <= 1;
      const globalItems = shouldTryGlobal ? await fetchBatch({ scopedTenant: false }) : [];
      const merged = new Map<string, PlanOption>();
      for (const item of [...scopedItems, ...globalItems]) {
        const mapped = mapPlanFromApi(item);
        if (mapped?.id) merged.set(mapped.id, mapped);
      }
      setRemotePlans(Array.from(merged.values()));
    } catch {
      setRemotePlans([]);
    } finally {
      setSearching(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    const timer = setTimeout(async () => {
      if (canceled) return;
      await fetchPlans(query);
    }, 250);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [open, query, fetchPlans]);

  const filteredPlans = useMemo(() => {
    const merged = new Map<string, PlanOption>();
    const current = plans.find((p) => p.id === resolvedPlanId) || remotePlans.find((p) => p.id === resolvedPlanId) || {
      id: resolvedPlanId,
      name: currentPlanName || "Plan actual",
      currency: currentPlanCurrency || "COP",
      kind: currentRequiresShipping ? "PRODUCT" : "SERVICE",
      requiresShipping: currentRequiresShipping,
      shippingInCents: Number(currentShippingInCents || 0)
    };
    if (current) merged.set(current.id, current);
    for (const p of localFilteredPlans) merged.set(p.id, p);
    for (const p of remotePlans) merged.set(p.id, p);
    if (planId && !merged.has(planId)) merged.set(planId, current);
    return Array.from(merged.values());
  }, [remotePlans, localFilteredPlans, plans, resolvedPlanId, planId, currentPlanName, currentPlanCurrency, currentRequiresShipping, currentShippingInCents]);

  const selectedPlan = useMemo(() => {
    return filteredPlans.find((p) => String(p.id) === String(planId)) || plans.find((p) => String(p.id) === String(planId)) || null;
  }, [filteredPlans, plans, planId]);

  const selectedRequiresShipping = planRequiresShipping(selectedPlan);
  const currentShippingComparable = currentRequiresShipping ? Number(currentShippingInCents || 0) : 0;
  const selectedShippingInCents = selectedRequiresShipping ? (freeShipping ? 0 : currencyInputToCents(shippingCop)) : 0;
  const shippingChanged = selectedRequiresShipping && selectedShippingInCents !== currentShippingComparable;
  const hasPlanChange = Boolean(planId && (planId !== resolvedPlanId || shippingChanged));

  useEffect(() => {
    const current = String(planId || "");
    if (!current || appliedDefaultsPlanIdRef.current === current) return;
    const plan = plans.find((p) => String(p.id) === current) || remotePlans.find((p) => String(p.id) === current);
    if (!plan) return;
    const requires = planRequiresShipping(plan);
    if (!requires) {
      setFreeShipping(false);
      setShippingCop("");
    } else {
      const nextShipping = Number(plan.shippingInCents || 0);
      setFreeShipping(nextShipping <= 0);
      setShippingCop(centsToCurrencyInput(nextShipping, String(plan.currency || "COP")));
    }
    appliedDefaultsPlanIdRef.current = current;
  }, [planId, plans, remotePlans]);

  const chargeDate = currentChargeAt ? new Date(currentChargeAt) : null;
  const periodStart = periodStartAt ? new Date(periodStartAt) : null;
  const fmtDate = (d: Date | null) => d ? new Intl.DateTimeFormat("es-CO", { dateStyle: "short" }).format(d) : "—";

  const handleBillingDateSave = async () => {
    setPendingBillingDate(true);
    setBillingDateError(null);
    try {
      const formData = new FormData();
      formData.set("csrf", csrfToken);
      formData.set("subscriptionId", subscriptionId);
      formData.set("chargeDate", dateValue);
      formData.set("chargeTime", timeValue);
      if (returnTo) formData.set("returnTo", returnTo);
      await setBillingChargeDate(formData);
    } catch (err) {
      setBillingDateError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setPendingBillingDate(false);
    }
  };

  return (
    <>
      <button className="ghost btn-compact btn-icon-only btn-edit" type="button" title="Editar suscripción" aria-label="Editar suscripción" onClick={() => setOpen(true)} />

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel subscription-edit-modal">
            <div className="panel-header">
              <h3>Editar suscripción</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>

            <div className="subscription-edit-grid">
              <section className="subscription-edit-section">
                <header>
                  <h4>Producto</h4>
                  <span className="muted">Cambia el plan y ajusta el flete.</span>
                </header>
                <form action={changeSubscriptionPlan} className="subscription-edit-form">
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="subscriptionId" value={subscriptionId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}

                  <div className="field">
                    <label className="field-label">
                      Buscar producto
                      <HelpTip text="Elige un plan existente o crea uno nuevo." />
                    </label>
                    <input className="input" type="search" placeholder="Nombre o SKU..." value={query} onChange={(e) => setQuery(e.target.value)} />
                    {searching ? <div className="field-hint">Buscando...</div> : null}
                    <select className="select" name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                      {filteredPlans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {!filteredPlans.length ? <div className="field-hint" style={{ color: "var(--danger)" }}>Sin resultados</div> : null}
                  </div>

                  {selectedRequiresShipping ? (
                    <div className="field">
                      <label className="field-label">
                        Flete
                        <HelpTip text="Valor del envío para esta suscripción." />
                      </label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input className="input" name="shippingPesos" inputMode="numeric" value={shippingCop} onChange={(e) => setShippingCop(formatCurrencyInput(e.target.value, String(selectedPlan?.currency || "COP")))} disabled={freeShipping} placeholder="$ 0" required={!freeShipping} style={{ flex: 1 }} />
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                          <input type="checkbox" checked={freeShipping} onChange={(e) => { const checked = e.target.checked; setFreeShipping(checked); if (checked) setShippingCop(""); }} />
                          Gratis
                        </label>
                      </div>
                      <input type="hidden" name="freeShipping" value={freeShipping ? "1" : "0"} />
                    </div>
                  ) : <><input type="hidden" name="shippingPesos" value="0" /><input type="hidden" name="freeShipping" value="0" /></>}

                  <div className="subscription-edit-actions">
                    <PendingButton className="primary btn-save" type="submit" pendingText="Guardando..." disabled={!hasPlanChange}>Cambiar plan</PendingButton>
                  </div>
                </form>
              </section>

              <section className="subscription-edit-section">
                <header>
                  <h4>Fecha de pago</h4>
                  <span className="muted">Próximo cobro y ciclo actual.</span>
                </header>
                
                <div className="subscription-edit-muted">
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--text-soft)" }}>Próximo cobro:</span>
                      <strong>{fmtDate(chargeDate)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--text-soft)" }}>Inicio ciclo:</span>
                      <strong>Día {cycleStartDay}</strong>
                    </div>
                    {periodStart && chargeDate ? (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "var(--text-soft)" }}>Ciclo actual:</span>
                        <strong>{periodStart.toLocaleDateString("es-CO")} → {chargeDate.toLocaleDateString("es-CO")}</strong>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">
                    Nueva fecha de cobro
                    <HelpTip text="Selecciona la fecha y hora para el próximo cobro." />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                    <input className="input" type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                    <input className="input" type="time" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} style={{ width: "auto" }} />
                  </div>
                </div>

                {billingDateError ? <div className="field-hint" style={{ color: "var(--danger)" }}>{billingDateError}</div> : null}

                <div className="subscription-edit-actions">
                  <PendingButton className="primary btn-save" type="button" pendingText="Guardando..." onClick={handleBillingDateSave} disabled={pendingBillingDate}>Actualizar fecha</PendingButton>
                </div>
              </section>

              <section className="subscription-edit-section">
                <header>
                  <h4>Configuración</h4>
                  <span className="muted">Periodicidad y parámetros de cobro.</span>
                </header>

                <div className="subscription-edit-muted">
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: "var(--text-soft)" }}>Periodicidad:</span>
                      <strong>{intervalCount} {intervalUnit === "MONTH" ? "mes(es)" : intervalUnit === "WEEK" ? "semana(s)" : "día(s)"}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: "var(--text-soft)" }}>Momento de cobro:</span>
                      <strong>{paymentTiming === "START" ? "Inicio de mes" : paymentTiming === "END" ? "Fin de mes" : `Día ${paymentDay}`}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: "var(--text-soft)" }}>Días de gracia:</span>
                      <strong>{graceDays} días</strong>
                    </div>
                  </div>
                </div>

                <div className="subscription-edit-actions">
                  <form action={updateSubscriptionBillingSettings} style={{ width: "100%" }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="subscriptionId" value={subscriptionId} />
                    {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                    <PendingButton className="secondary" type="submit" pendingText="Actualizando..." style={{ width: "100%" }}>Actualizar configuración</PendingButton>
                  </form>
                </div>
              </section>

              <section className="subscription-edit-section subscription-edit-wide">
                <header>
                  <h4 style={{ color: "var(--danger)" }}>Eliminar suscripción</h4>
                  <span className="muted">Esta acción no se puede deshacer.</span>
                </header>
                <form action={deleteSubscription} onSubmit={(e) => { if (!confirm("¿Eliminar esta suscripción y sus pagos relacionados?")) e.preventDefault(); }} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="subscriptionId" value={subscriptionId} />
                  {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                  {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                  <button className="ghost btn-compact btn-red" type="submit">Eliminar suscripción</button>
                </form>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
