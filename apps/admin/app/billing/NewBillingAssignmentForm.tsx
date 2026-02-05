"use client";

import { useEffect, useMemo, useState } from "react";

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

function customerLabel(c: Customer) {
  const idRaw =
    c?.metadata?.identificacion ||
    (c?.metadata?.identificacionTipo && c?.metadata?.identificacionNumero ? `${c.metadata.identificacionTipo} ${c.metadata.identificacionNumero}` : "") ||
    "";
  const id = idRaw ? ` · ${String(idRaw)}` : "";
  return `${c.email || c.name || c.id}${id}`;
}

export function NewBillingAssignmentForm({
  plans,
  customers,
  createSubscription,
  createCustomer,
  preselectCustomerId
}: {
  plans: Plan[];
  customers: Customer[];
  createSubscription: (formData: FormData) => void | Promise<void>;
  createCustomer: (formData: FormData) => void | Promise<void>;
  preselectCustomerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<"PLAN" | "SUBSCRIPCION">("PLAN");
  const [planQ, setPlanQ] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id || "");
  const [customerId, setCustomerId] = useState(preselectCustomerId || customers[0]?.id || "");
  const [generateLink, setGenerateLink] = useState(false);

  const [startLocal, setStartLocal] = useState(localNowString());
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [cutoffSameAsStart, setCutoffSameAsStart] = useState(false);

  useEffect(() => {
    if (!preselectCustomerId) return;
    setCustomerId(preselectCustomerId);
    setOpen(true);
  }, [preselectCustomerId]);

  useEffect(() => {
    setGenerateLink(false);
  }, [tipo]);

  useEffect(() => {
    if (!cutoffSameAsStart) return;
    setCutoffLocal(startLocal);
  }, [cutoffSameAsStart, startLocal]);

  useEffect(() => {
    if (tipo !== "PLAN") return;
    if (!cutoffSameAsStart) return;
    setGenerateLink(true);
  }, [tipo, cutoffSameAsStart]);

  const filteredPlans = useMemo(() => {
    const q = planQ.trim().toLowerCase();
    return plans
      .filter((p) => {
        const mode = getPlanMode(p);
        if (tipo === "SUBSCRIPCION") return mode === "AUTO_DEBIT";
        return mode !== "AUTO_DEBIT";
      })
      .filter((p) => {
        if (!q) return true;
        return String(p.name || "").toLowerCase().includes(q);
      })
      .slice(0, 200);
  }, [plans, planQ, tipo]);

  useEffect(() => {
    if (!filteredPlans.length) return;
    if (filteredPlans.some((p) => p.id === planId)) return;
    setPlanId(filteredPlans[0].id);
  }, [filteredPlans, planId]);

  const filteredCustomers = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    return customers.filter((c) => {
      if (!q) return true;
      const hay =
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.email || "").toLowerCase().includes(q) ||
        String(c.phone || "").toLowerCase().includes(q) ||
        String(c.metadata?.identificacion || "").toLowerCase().includes(q) ||
        String(c.metadata?.identificacionNumero || "").toLowerCase().includes(q);
      return hay;
    });
  }, [customers, customerQ]);

  useEffect(() => {
    if (!filteredCustomers.length) return;
    if (filteredCustomers.some((c) => c.id === customerId)) return;
    setCustomerId(filteredCustomers[0].id);
  }, [filteredCustomers, customerId]);

  const startAt = useMemo(() => toIsoFromLocalInput(startLocal), [startLocal]);
  const firstPeriodEndAt = useMemo(() => toIsoFromLocalInput(cutoffLocal), [cutoffLocal]);

  const selectedPlan = useMemo(() => plans.find((p) => p.id === planId) || null, [plans, planId]);

  const [showNewCustomer, setShowNewCustomer] = useState(false);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3>Crear nuevo</h3>
        <button type="button" className={open ? "btnLink" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear plan o suscripción"}
        </button>
      </div>

      {open ? (
        <div style={{ display: "grid", gap: 10 }}>
          <form action={createSubscription} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>Tipo</label>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                  <option value="PLAN">Plan (link de pago)</option>
                  <option value="SUBSCRIPCION">Suscripción (cobro automático)</option>
                </select>
                <div className="field-hint">
                  {tipo === "SUBSCRIPCION"
                    ? "Si el contacto no tiene tarjeta tokenizada, se genera un link de pago y se envía por la central de comunicaciones."
                    : "Se genera un link de pago y se envía por la central de comunicaciones (si está configurada)."}
                </div>
              </div>

              <div className="field">
                <label>Contacto</label>
                <input className="input" placeholder="Buscar..." value={customerQ} onChange={(e) => setCustomerQ(e.target.value)} />
                <select className="select" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {customerLabel(c)}
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                  <button type="button" className="ghost" onClick={() => setShowNewCustomer((v) => !v)}>
                    {showNewCustomer ? "Ocultar" : "Crear contacto"}
                  </button>
                  <span className="field-hint">{customers.length} en la lista</span>
                </div>
              </div>
            </div>

            <div className="field">
              <label>Plan / Suscripción</label>
              <input className="input" placeholder="Buscar..." value={planQ} onChange={(e) => setPlanQ(e.target.value)} />
              <select className="select" name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
                {filteredPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {fmtMoney(p.priceInCents, p.currency)} · {fmtEvery(p.intervalUnit, p.intervalCount)}
                  </option>
                ))}
              </select>
              {selectedPlan ? (
                <div className="field-hint">
                  Monto: {fmtMoney(selectedPlan.priceInCents, selectedPlan.currency)} · {fmtEvery(selectedPlan.intervalUnit, selectedPlan.intervalCount)}
                </div>
              ) : null}
            </div>

            <input type="hidden" name="startAt" value={startAt} />
            <input type="hidden" name="firstPeriodEndAt" value={firstPeriodEndAt} />

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

          <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
            <input
              name="createPaymentLink"
              type="checkbox"
              checked={generateLink}
              onChange={(e) => setGenerateLink(e.target.checked)}
            />
            <span>Generar link de pago (si aplica)</span>
          </label>

            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="primary" type="submit" disabled={!filteredPlans.length || !filteredCustomers.length}>
                Crear
              </button>
            </div>
          </form>

          {showNewCustomer ? (
            <form action={createCustomer} className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
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
                <div className="field-hint">Al guardar, el contacto queda disponible para asociarlo al cobro.</div>
              </div>
            </form>
          ) : null}
        </div>
      ) : (
        <div className="field-hint">Crea un plan o una suscripción y asígnalo a un contacto.</div>
      )}
    </div>
  );
}
