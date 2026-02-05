"use client";

import { useEffect, useMemo, useState } from "react";
import { NewPlanTemplateForm } from "./NewPlanTemplateForm";

type Plan = {
  id: string;
  name: string;
  priceInCents: number;
  currency: string;
  intervalUnit: string;
  intervalCount: number;
  metadata?: any;
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

function localNowString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function toIsoFromLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function fmtMoney(cents: any, currency = "COP") {
  const v = Number(cents);
  if (!Number.isFinite(v)) return "—";
  const major = Math.trunc(v / 100);
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
  return `cada ${c} (personalizado)`;
}

function getPlanMode(p: Plan) {
  return String(p?.metadata?.collectionMode || "MANUAL_LINK");
}

function getTipoPlan(p: Plan) {
  const mode = getPlanMode(p);
  return mode === "AUTO_DEBIT" ? "Suscripción" : "Plan";
}

function customerLabel(c: Customer) {
  const idRaw =
    c?.metadata?.identificacion ||
    (c?.metadata?.identificacionTipo && c?.metadata?.identificacionNumero ? `${c.metadata.identificacionTipo} ${c.metadata.identificacionNumero}` : "") ||
    "";
  const id = idRaw ? ` · ${String(idRaw)}` : "";
  const who = c.name || c.email || c.id;
  return `${who}${id}`;
}

export function NewBillingAssignmentForm({
  plans,
  customers,
  catalogItems,
  createPlanTemplate,
  createSubscription,
  createCustomer,
  preselectPlanId,
  preselectCustomerId
}: {
  plans: Plan[];
  customers: Customer[];
  catalogItems: CatalogItem[];
  createPlanTemplate: (formData: FormData) => void | Promise<void>;
  createSubscription: (formData: FormData) => void | Promise<void>;
  createCustomer: (formData: FormData) => void | Promise<void>;
  preselectPlanId?: string;
  preselectCustomerId?: string;
}) {
  const [open, setOpen] = useState(false);

  const [planTipo, setPlanTipo] = useState<"todos" | "planes" | "suscripciones">("todos");
  const [planQ, setPlanQ] = useState("");
  const [planId, setPlanId] = useState(preselectPlanId || plans[0]?.id || "");

  const [showNewPlan, setShowNewPlan] = useState(false);

  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState(preselectCustomerId || customers[0]?.id || "");
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const [startLocal, setStartLocal] = useState(localNowString());
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [cutoffSameAsStart, setCutoffSameAsStart] = useState(false);
  const [generateLink, setGenerateLink] = useState(false);

  useEffect(() => {
    if (!preselectPlanId && !preselectCustomerId) return;
    setOpen(true);
  }, [preselectPlanId, preselectCustomerId]);

  useEffect(() => {
    if (!preselectPlanId) return;
    setPlanId(preselectPlanId);
  }, [preselectPlanId]);

  useEffect(() => {
    if (!preselectCustomerId) return;
    setCustomerId(preselectCustomerId);
  }, [preselectCustomerId]);

  useEffect(() => {
    if (!cutoffSameAsStart) return;
    setCutoffLocal(startLocal);
  }, [cutoffSameAsStart, startLocal]);

  const filteredPlans = useMemo(() => {
    const q = planQ.trim().toLowerCase();
    return plans
      .filter((p) => {
        const tipo = getTipoPlan(p);
        if (planTipo === "planes") return tipo === "Plan";
        if (planTipo === "suscripciones") return tipo === "Suscripción";
        return true;
      })
      .filter((p) => {
        if (!q) return true;
        return String(p.name || "").toLowerCase().includes(q);
      })
      .slice(0, 200);
  }, [plans, planQ, planTipo]);

  useEffect(() => {
    if (!filteredPlans.length) return;
    if (filteredPlans.some((p) => p.id === planId)) return;
    setPlanId(filteredPlans[0].id);
  }, [filteredPlans, planId]);

  const filteredCustomers = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (!q) return true;
        const hay =
          String(c.name || "").toLowerCase().includes(q) ||
          String(c.email || "").toLowerCase().includes(q) ||
          String(c.phone || "").toLowerCase().includes(q) ||
          String(c.metadata?.identificacion || "").toLowerCase().includes(q) ||
          String(c.metadata?.identificacionNumero || "").toLowerCase().includes(q);
        return hay;
      })
      .slice(0, 200);
  }, [customers, customerQ]);

  useEffect(() => {
    if (!filteredCustomers.length) return;
    if (filteredCustomers.some((c) => c.id === customerId)) return;
    setCustomerId(filteredCustomers[0].id);
  }, [filteredCustomers, customerId]);

  const selectedPlan = useMemo(() => plans.find((p) => p.id === planId) || null, [plans, planId]);
  const selectedPlanMode = selectedPlan ? getPlanMode(selectedPlan) : "";
  const isAutoDebit = selectedPlanMode === "AUTO_DEBIT";

  useEffect(() => {
    // Default: for plans, create link when cutoff == start (cobrar hoy)
    if (!selectedPlan) return;
    if (isAutoDebit) {
      setGenerateLink(false);
      return;
    }
    if (cutoffSameAsStart) setGenerateLink(true);
  }, [selectedPlan, isAutoDebit, cutoffSameAsStart]);

  const startAt = useMemo(() => toIsoFromLocalInput(startLocal), [startLocal]);
  const firstPeriodEndAt = useMemo(() => toIsoFromLocalInput(cutoffLocal), [cutoffLocal]);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3>Crear nuevo</h3>
        <button type="button" className={open ? "btnLink" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear nuevo"}
        </button>
      </div>

      {open ? (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Paso 1: Plan */}
          <div className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <strong>1) Plan / Suscripción</strong>
              <button type="button" className="ghost" onClick={() => setShowNewPlan((v) => !v)}>
                {showNewPlan ? "Ocultar" : "Crear nuevo plan"}
              </button>
            </div>

            {showNewPlan ? (
              <div style={{ marginTop: 10 }}>
                <NewPlanTemplateForm action={createPlanTemplate} catalogItems={catalogItems} />
              </div>
            ) : null}

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, alignItems: "end" }}>
                <div className="field">
                  <label>Tipo</label>
                  <select className="select" value={planTipo} onChange={(e) => setPlanTipo(e.target.value as any)}>
                    <option value="todos">Todos</option>
                    <option value="planes">Planes</option>
                    <option value="suscripciones">Suscripciones</option>
                  </select>
                </div>
                <div className="field">
                  <label>Buscar</label>
                  <input className="input" placeholder="Buscar por nombre..." value={planQ} onChange={(e) => setPlanQ(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <label>Seleccionar</label>
                <select className="select" name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
                  {filteredPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {getTipoPlan(p)} · {p.name} · {fmtMoney(p.priceInCents, p.currency)} · {fmtEvery(p.intervalUnit, p.intervalCount)}
                    </option>
                  ))}
                </select>
                {selectedPlan ? (
                  <div className="field-hint">
                    {getTipoPlan(selectedPlan)} · {fmtMoney(selectedPlan.priceInCents, selectedPlan.currency)} · {fmtEvery(selectedPlan.intervalUnit, selectedPlan.intervalCount)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Paso 2: Contacto */}
          <div className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <strong>2) Contacto</strong>
              <button type="button" className="ghost" onClick={() => setShowNewCustomer((v) => !v)}>
                {showNewCustomer ? "Ocultar" : "Crear contacto"}
              </button>
            </div>

            {showNewCustomer ? (
              <form action={createCustomer} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)", marginTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <strong>Nuevo contacto</strong>
                  <button className="ghost" type="submit">
                    Guardar contacto
                  </button>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <div className="field">
                    <label>Nombre</label>
                    <input className="input" name="name" placeholder="Nombre completo" required />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Teléfono</label>
                      <input className="input" name="phone" placeholder="+57..." />
                    </div>
                    <div className="field">
                      <label>Email (opcional)</label>
                      <input className="input" name="email" placeholder="correo@empresa.com" />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                    <div className="field">
                      <label>Tipo</label>
                      <select className="select" name="idType" defaultValue="CC">
                        <option value="CC">CC</option>
                        <option value="NIT">NIT</option>
                        <option value="CE">CE</option>
                        <option value="PP">PP</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Número de identificación</label>
                      <input className="input" name="idNumber" placeholder="123456789" />
                    </div>
                  </div>
                </div>
              </form>
            ) : null}

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div className="field">
                <label>Buscar</label>
                <input className="input" placeholder="Buscar..." value={customerQ} onChange={(e) => setCustomerQ(e.target.value)} />
              </div>
              <div className="field">
                <label>Seleccionar</label>
                <select className="select" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {customerLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Paso 3: Fechas */}
          <form action={createSubscription} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="planId" value={planId} />
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="startAt" value={startAt} />
            <input type="hidden" name="firstPeriodEndAt" value={firstPeriodEndAt} />

            <div className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <strong>3) Fechas</strong>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field">
                    <label>Fecha de activación</label>
                    <input className="input" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} step={60} />
                  </div>

                  <div className="field">
                    <label>Fecha de corte (primer cobro)</label>
                    <input
                      className="input"
                      type="datetime-local"
                      value={cutoffLocal}
                      onChange={(e) => setCutoffLocal(e.target.value)}
                      step={60}
                      disabled={cutoffSameAsStart}
                    />
                    <label className="field" style={{ marginTop: 6, gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={cutoffSameAsStart}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setCutoffSameAsStart(v);
                          if (v) setCutoffLocal(startLocal);
                        }}
                      />
                      <span>La fecha de corte es la misma que la activación</span>
                    </label>
                    <div className="field-hint">Si la fecha de corte se deja vacía, se calcula con el plan.</div>
                  </div>
                </div>

                {!isAutoDebit ? (
                  <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
                    <input name="createPaymentLink" type="checkbox" checked={generateLink} onChange={(e) => setGenerateLink(e.target.checked)} />
                    <span>Generar link de pago (si aplica)</span>
                  </label>
                ) : (
                  <input type="hidden" name="createPaymentLink" value="" />
                )}

                <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button className="primary" type="submit" disabled={!planId || !customerId}>
                    Crear
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <div className="field-hint">Selecciona un plan/suscripción, un contacto y define fechas.</div>
      )}
    </div>
  );
}

