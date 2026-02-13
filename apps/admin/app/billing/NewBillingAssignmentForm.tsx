"use client";

import { useEffect, useMemo, useState } from "react";
import { NewCustomerForm } from "../customers/NewCustomerForm";
import { NewPlanTemplateForm } from "./NewPlanTemplateForm";
import { enterToNextField } from "../lib/enterToNext";
import { HelpTip } from "../ui/HelpTip";

type Plan = {
  id: string;
  name: string;
  currency?: string;
  priceInCents?: number;
  intervalUnit?: string;
  intervalCount?: number;
  metadata?: { collectionMode?: string } | null;
};

type Customer = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: any;
};

type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  currency: string;
  basePriceInCents: number;
  taxPercent?: number;
  discountType?: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents?: number;
  discountPercent?: number;
  option1Name?: string | null;
  option2Name?: string | null;
  variants?: Array<{ option1?: string | null; option2?: string | null; priceDeltaInCents: number }> | null;
};

function fmtMoneyFromCents(cents: number, currency = "COP") {
  const major = Math.trunc(Number(cents || 0) / 100);
  if (currency !== "COP") return `${major} ${currency}`;
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(major);
}

function fmtEvery(intervalUnit: any, intervalCount: any) {
  const unit = String(intervalUnit || "").toUpperCase();
  const count = Number(intervalCount || 1);
  const c = Number.isFinite(count) && count > 0 ? count : 1;
  if (unit === "DAY") return c === 1 ? "cada día" : `cada ${c} días`;
  if (unit === "WEEK") return c === 1 ? "cada semana" : `cada ${c} semanas`;
  if (unit === "MONTH") return c === 1 ? "cada mes" : `cada ${c} meses`;
  return `cada ${c}`;
}

function planTipo(plan: Plan | null) {
  const mode = String(plan?.metadata?.collectionMode || "MANUAL_LINK");
  return mode === "AUTO_DEBIT" ? "SUSCRIPCION" : "PLAN";
}

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(localValue: string) {
  const v = String(localValue || "").trim();
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function NewBillingAssignmentForm({
  plans,
  customers,
  catalogItems,
  csrfToken,
  defaultOpen = false,
  defaultSelectedPlanId = "",
  defaultSelectedCustomerId = "",
  createPlanTemplate,
  createCustomer,
  createSubscription
}: {
  plans: Plan[];
  customers: Customer[];
  catalogItems: CatalogItem[];
  csrfToken: string;
  defaultOpen?: boolean;
  defaultSelectedPlanId?: string;
  defaultSelectedCustomerId?: string;
  createPlanTemplate: (formData: FormData) => void | Promise<void>;
  createCustomer: (formData: FormData) => Promise<void>;
  createSubscription: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const [planQ, setPlanQ] = useState("");
  const [planId, setPlanId] = useState(defaultSelectedPlanId || "");

  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState(defaultSelectedCustomerId || "");
  const [customerHits, setCustomerHits] = useState<Customer[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [selectedCustomerOverride, setSelectedCustomerOverride] = useState<Customer | null>(null);

  const [startLocal, setStartLocal] = useState("");
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [sameCutoff, setSameCutoff] = useState(true);
  const [createLinkNow, setCreateLinkNow] = useState(false);

  useEffect(() => {
    const now = new Date();
    const v = toDatetimeLocalValue(now);
    setStartLocal((x) => x || v);
    setCutoffLocal((x) => x || v);
  }, []);

  useEffect(() => {
    if (sameCutoff) setCutoffLocal(startLocal);
  }, [sameCutoff, startLocal]);

  const selectedPlan = useMemo(() => plans.find((p) => String(p.id) === String(planId)) || null, [plans, planId]);
  const selectedCustomer = useMemo(() => {
    if (!customerId) return null;
    if (selectedCustomerOverride && String(selectedCustomerOverride.id) === String(customerId)) return selectedCustomerOverride;
    return (
      customers.find((c) => String(c.id) === String(customerId)) ||
      customerHits.find((c) => String(c.id) === String(customerId)) ||
      null
    );
  }, [customers, customerHits, customerId, selectedCustomerOverride]);

  const filteredPlans = useMemo(() => {
    const q = planQ.trim().toLowerCase();
    const list = plans.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
    if (!q) return list.slice(0, 200);
    return list.filter((p) => `${p.name || ""} ${p.id}`.toLowerCase().includes(q)).slice(0, 200);
  }, [plans, planQ]);

  const filteredCustomers = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    if (q.length >= 2) {
      const list = customerHits.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      return list.slice(0, 200);
    }

    const list = customers.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
    if (!q) return list.slice(0, 200);
    return list
      .filter((c) => `${c.name || ""} ${c.email || ""} ${c.phone || ""} ${c.metadata?.identificacion || ""} ${c.id}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [customers, customerHits, customerQ]);

  useEffect(() => {
    const q = customerQ.trim();
    if (q.length < 2) {
      setCustomerHits([]);
      setCustomerSearching(false);
      setCustomerSearchError("");
      return;
    }

    const ac = new AbortController();
    setCustomerSearching(true);
    setCustomerSearchError("");
    const t = setTimeout(() => {
      fetch(`/api/search/customers?${new URLSearchParams({ q, take: "80" }).toString()}`, { cache: "no-store", signal: ac.signal })
        .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }))
        .then(({ ok, status, json }) => {
          if (!ok) {
            setCustomerHits([]);
            setCustomerSearchError(status === 401 ? "No autorizado (revisa el token del Admin)." : `Error buscando contactos (${status}).`);
            return;
          }
          const items = Array.isArray(json?.items) ? (json.items as Customer[]) : [];
          setCustomerHits(items);
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          setCustomerHits([]);
          setCustomerSearchError("Error de red buscando contactos.");
        })
        .finally(() => {
          if (ac.signal.aborted) return;
          setCustomerSearching(false);
        });
    }, 250);

    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [customerQ]);

  const returnTo = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("crear", "1");
    if (planId) sp.set("selectPlanId", planId);
    if (customerId) sp.set("selectCustomerId", customerId);
    return `/billing?${sp.toString()}`;
  }, [planId, customerId]);

  useEffect(() => {
    if (!selectedPlan) return;
    const tipo = planTipo(selectedPlan);
    if (tipo === "PLAN") setCreateLinkNow(true);
    if (tipo === "SUSCRIPCION") setCreateLinkNow(false);
  }, [selectedPlan]);

  const primaryLabel = useMemo(() => {
    if (!selectedPlan) return "Guardar";
    const tipo = planTipo(selectedPlan);
    if (tipo === "PLAN" && createLinkNow) return "Generar link de pago";
    return "Guardar";
  }, [selectedPlan, createLinkNow]);

  const startAtIso = useMemo(() => localToIso(startLocal), [startLocal]);
  const cutoffAtIso = useMemo(() => localToIso(cutoffLocal), [cutoffLocal]);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "grid" }}>
          <h3 style={{ margin: 0 }}>Crear plan o suscripción para un contacto</h3>
        </div>
        <button className={open ? "ghost" : "primary"} type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear nuevo"}
        </button>
      </div>

      {open ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>1) Plan o suscripción</h3>
              <button className="ghost" type="button" onClick={() => setShowNewPlan((v) => !v)}>
                {showNewPlan ? "Cerrar" : "Crear plantilla"}
              </button>
            </div>

            {selectedPlan ? (
              <div className="card cardPad" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "grid" }}>
                  <strong>{selectedPlan.name}</strong>
                  <span className="field-hint">
                    {planTipo(selectedPlan) === "SUSCRIPCION" ? "Suscripción" : "Plan"} ·{" "}
                    {fmtMoneyFromCents(Number(selectedPlan.priceInCents || 0), String(selectedPlan.currency || "COP"))} ·{" "}
                    {fmtEvery(selectedPlan.intervalUnit, selectedPlan.intervalCount)}
                  </span>
                </div>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setPlanId("");
                    setPlanQ("");
                    setCustomerId("");
                    setCustomerQ("");
                    setCustomerHits([]);
                    setSelectedCustomerOverride(null);
                  }}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <input className="input" value={planQ} onChange={(e) => setPlanQ(e.target.value)} placeholder="Buscar por nombre…" aria-label="Buscar plan o suscripción" />
                <select
                  className="select"
                  value={planId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPlanId(id);
                    setShowNewPlan(false);
                  }}
                >
                  <option value="">Selecciona una plantilla…</option>
                  {filteredPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {planTipo(p as any) === "SUSCRIPCION" ? "Suscripción" : "Plan"} ·{" "}
                      {fmtMoneyFromCents(Number(p.priceInCents || 0), String(p.currency || "COP"))} · {fmtEvery(p.intervalUnit, p.intervalCount)}
                    </option>
                  ))}
                </select>
                {filteredPlans.length === 0 ? <div style={{ color: "var(--muted)" }}>No se encontraron plantillas.</div> : null}
              </div>
            )}

            {showNewPlan ? (
              <div style={{ marginTop: 10 }}>
                <NewPlanTemplateForm action={createPlanTemplate} catalogItems={catalogItems} returnTo={returnTo} csrfToken={csrfToken} />
              </div>
            ) : null}
          </div>

          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>2) Contacto</h3>
              <button className="ghost" type="button" onClick={() => setShowNewCustomer((v) => !v)}>
                {showNewCustomer ? "Cerrar" : "Crear contacto"}
              </button>
            </div>

            {selectedCustomer ? (
              <div className="card cardPad" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "grid" }}>
                  <strong>{selectedCustomer.name || selectedCustomer.email || selectedCustomer.id}</strong>
                  <span className="field-hint">
                    {selectedCustomer.metadata?.identificacion || "—"}
                    {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                    {selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}
                  </span>
                </div>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setCustomerId("");
                    setCustomerQ("");
                    setCustomerHits([]);
                    setSelectedCustomerOverride(null);
                  }}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  className="input"
                  value={customerQ}
                  onChange={(e) => setCustomerQ(e.target.value)}
                  placeholder="Buscar por nombre, email o identificación…"
                  aria-label="Buscar contacto"
                />
                <div aria-live="polite">
                  {customerSearching ? <div className="field-hint">Buscando…</div> : null}
                  {customerSearchError ? <div className="field-hint" style={{ color: "rgba(217, 83, 79, 0.92)" }}>{customerSearchError}</div> : null}
                </div>
                <select
                  className="select"
                  value={customerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCustomerId(id);
                    const picked = filteredCustomers.find((c) => String(c.id) === String(id)) || null;
                    setSelectedCustomerOverride(picked);
                    setShowNewCustomer(false);
                  }}
                >
                  <option value="">Selecciona un contacto…</option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.email || c.id} · {c.metadata?.identificacion || c.email || c.phone || "—"}
                    </option>
                  ))}
                </select>
                {!customerSearching && filteredCustomers.length === 0 ? (
                  <div className="field-hint">
                    {customerQ.trim().length >= 2 ? "Sin resultados. Prueba con otro término." : "No se encontraron contactos."}
                  </div>
                ) : null}
              </div>
            )}

            {showNewCustomer ? (
              <div style={{ marginTop: 10 }}>
                <NewCustomerForm createCustomer={createCustomer} defaultOpen mode="always_open" hidePanelHeader returnTo={returnTo} csrfToken={csrfToken} />
              </div>
            ) : null}
          </div>

          <div className="panel module" style={{ margin: 0, opacity: planId && customerId ? 1 : 0.6 }}>
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>3) Fechas</h3>
            </div>

            <form action={createSubscription} onKeyDownCapture={enterToNextField} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="planId" value={planId} />
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="startAt" value={startAtIso} />
              <input type="hidden" name="firstPeriodEndAt" value={cutoffAtIso} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Inicio (activación)</span>
                    <HelpTip text="Fecha/hora en la que inicia la suscripción." />
                  </label>
                  <input className="input" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} disabled={!planId || !customerId} />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Corte (cobro)</span>
                    <HelpTip text="Fecha/hora del primer cobro. Si se deja igual al inicio, se cobra de inmediato." />
                  </label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={cutoffLocal}
                    onChange={(e) => setCutoffLocal(e.target.value)}
                    disabled={!planId || !customerId || sameCutoff}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={sameCutoff} onChange={(e) => setSameCutoff(e.target.checked)} disabled={!planId || !customerId} />
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span>Corte = inicio</span>
                      <HelpTip text="Usa la misma fecha/hora de activación." />
                    </span>
                  </label>
                </div>
              </div>

              {selectedPlan ? (
                planTipo(selectedPlan) === "PLAN" ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <input type="hidden" name="createPaymentLink" value="on" />
                    <div className="field-hint">
                      Se generará un link de pago para este contacto.
                    </div>
                  </div>
                ) : (
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      name="createPaymentLink"
                      checked={createLinkNow}
                      onChange={(e) => setCreateLinkNow(e.target.checked)}
                      disabled={!planId || !customerId}
                    />
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      Generar link de pago si no se puede cobrar automáticamente
                      <HelpTip text="Si no hay método de pago, se crea un link para cobrar." />
                    </span>
                  </label>
                )
              ) : null}

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
                <button className="primary" type="submit" disabled={!planId || !customerId}>
                  {primaryLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        null
      )}
    </div>
  );
}
