"use client";

import { useEffect, useMemo, useState } from "react";
import { NewCustomerForm } from "../customers/NewCustomerForm";
import { NewPlanTemplateForm } from "./NewPlanTemplateForm";

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
  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(customerId)) || null,
    [customers, customerId]
  );

  const filteredPlans = useMemo(() => {
    const q = planQ.trim().toLowerCase();
    const list = plans.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
    if (!q) return list.slice(0, 300);
    return list.filter((p) => `${p.name || ""} ${p.id}`.toLowerCase().includes(q)).slice(0, 300);
  }, [plans, planQ]);

  const filteredCustomers = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    const list = customers.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
    if (!q) return list.slice(0, 300);
    return list
      .filter((c) => `${c.name || ""} ${c.email || ""} ${c.phone || ""} ${c.metadata?.identificacion || ""} ${c.id}`.toLowerCase().includes(q))
      .slice(0, 300);
  }, [customers, customerQ]);

  const returnTo = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("crear", "1");
    if (planId) sp.set("selectPlanId", planId);
    if (customerId) sp.set("selectCustomerId", customerId);
    return `/billing?${sp.toString()}`;
  }, [planId, customerId]);

  useEffect(() => {
    const tipo = planTipo(selectedPlan);
    if (tipo === "PLAN" && sameCutoff) setCreateLinkNow(true);
    if (tipo === "SUSCRIPCION") setCreateLinkNow(false);
  }, [selectedPlan, sameCutoff]);

  const startAtIso = useMemo(() => localToIso(startLocal), [startLocal]);
  const cutoffAtIso = useMemo(() => localToIso(cutoffLocal), [cutoffLocal]);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "grid" }}>
          <h3 style={{ margin: 0 }}>Crear plan / suscripción (para un contacto)</h3>
          <div className="field-hint">Selecciona un plan/suscripción ya creado (plantilla) y asígnalo a un contacto.</div>
        </div>
        <button className={open ? "ghost" : "primary"} type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear"}
        </button>
      </div>

      {open ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="panel module" style={{ margin: 0 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>1) Plan o suscripción</h3>
              <button className={showNewPlan ? "ghost" : "primary"} type="button" onClick={() => setShowNewPlan((v) => !v)}>
                {showNewPlan ? "Ocultar" : "Crear nuevo"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Buscar</label>
                <input className="input" value={planQ} onChange={(e) => setPlanQ(e.target.value)} placeholder="Buscar por nombre..." />
              </div>
              <div className="field">
                <label>Elegir existente</label>
                <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
                  <option value="">Selecciona…</option>
                  {filteredPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {planTipo(p as any) === "SUSCRIPCION" ? "Suscripción" : "Plan"} ·{" "}
                      {fmtMoneyFromCents(Number(p.priceInCents || 0), String(p.currency || "COP"))} · {fmtEvery(p.intervalUnit, p.intervalCount)}
                    </option>
                  ))}
                </select>
                <div className="field-hint">
                  Si es un <strong>Plan</strong>, el sistema envía un link de pago. Si es <strong>Suscripción</strong>, el sistema intenta cobrar automáticamente.
                </div>
              </div>

              {showNewPlan ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <NewPlanTemplateForm action={createPlanTemplate} catalogItems={catalogItems} returnTo={returnTo} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel module" style={{ margin: 0, opacity: planId ? 1 : 0.6 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>2) Contacto</h3>
              <button
                className={showNewCustomer ? "ghost" : "primary"}
                type="button"
                onClick={() => setShowNewCustomer((v) => !v)}
                disabled={!planId}
                aria-disabled={!planId}
              >
                {showNewCustomer ? "Ocultar" : "Crear nuevo"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Buscar</label>
                <input className="input" value={customerQ} onChange={(e) => setCustomerQ(e.target.value)} placeholder="Buscar por nombre, email, identificación..." disabled={!planId} />
              </div>
              <div className="field">
                <label>Elegir existente</label>
                <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required disabled={!planId}>
                  <option value="">Selecciona…</option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.email || c.id} · {c.metadata?.identificacion || "—"}
                    </option>
                  ))}
                </select>
              </div>

              {showNewCustomer ? (
                <NewCustomerForm createCustomer={createCustomer} defaultOpen mode="always_open" hidePanelHeader returnTo={returnTo} />
              ) : null}
            </div>
          </div>

          <div className="panel module" style={{ margin: 0, opacity: planId && customerId ? 1 : 0.6 }}>
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>3) Fechas</h3>
            </div>

            <form action={createSubscription} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="planId" value={planId} />
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="startAt" value={startAtIso} />
              <input type="hidden" name="firstPeriodEndAt" value={cutoffAtIso} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Fecha de inicio (activación)</label>
                  <input className="input" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} disabled={!planId || !customerId} />
                </div>
                <div className="field">
                  <label>Fecha de corte (cobro)</label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={cutoffLocal}
                    onChange={(e) => setCutoffLocal(e.target.value)}
                    disabled={!planId || !customerId || sameCutoff}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <input type="checkbox" checked={sameCutoff} onChange={(e) => setSameCutoff(e.target.checked)} disabled={!planId || !customerId} />
                    <span>La fecha de corte es la misma que la fecha de inicio</span>
                  </label>
                </div>
              </div>

              {planTipo(selectedPlan) === "PLAN" ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    name="createPaymentLink"
                    checked={createLinkNow}
                    onChange={(e) => setCreateLinkNow(e.target.checked)}
                    disabled={!planId || !customerId}
                  />
                  <span>Generar link de pago ahora (si la fecha de corte es hoy)</span>
                </label>
              ) : (
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    name="createPaymentLink"
                    checked={createLinkNow}
                    onChange={(e) => setCreateLinkNow(e.target.checked)}
                    disabled={!planId || !customerId}
                  />
                  <span>Generar link de pago ahora (si no hay tarjeta tokenizada)</span>
                </label>
              )}

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="primary" type="submit" disabled={!planId || !customerId}>
                  Guardar
                </button>
              </div>

              {selectedCustomer ? (
                <div className="field-hint">
                  Contacto: <strong>{selectedCustomer.name || selectedCustomer.email || selectedCustomer.id}</strong>
                </div>
              ) : null}
              {selectedPlan ? (
                <div className="field-hint">
                  Plantilla: <strong>{selectedPlan.name}</strong> · {planTipo(selectedPlan) === "SUSCRIPCION" ? "Suscripción" : "Plan"}
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : (
        <div className="field-hint">Usa este formulario para crear el cobro recurrente o enviar un link al contacto.</div>
      )}
    </div>
  );
}
