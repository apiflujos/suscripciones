"use client";

import { useEffect, useMemo, useState } from "react";

type Customer = { id: string; name?: string | null; email?: string | null };

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

function toIsoFromLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function localNowString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function addIntervalLocal(localStart: string, unit: string, count: number) {
  const d = new Date(localStart);
  if (Number.isNaN(d.getTime())) return "";
  const n = Number(count);
  const c = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
  if (unit === "DAY") d.setDate(d.getDate() + c);
  else if (unit === "WEEK") d.setDate(d.getDate() + c * 7);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + c);
  else d.setDate(d.getDate() + c * 30);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtMoneyFromCents(cents: number) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

export function NewPlanOrSubscriptionForm({
  action,
  customers,
  catalogItems
}: {
  action: (formData: FormData) => void | Promise<void>;
  customers: Customer[];
  catalogItems: CatalogItem[];
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<"PLAN" | "SUBSCRIPTION">("SUBSCRIPTION");
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [catalogItemId, setCatalogItemId] = useState(catalogItems[0]?.id || "");

  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");

  const [startLocal, setStartLocal] = useState(localNowString());
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [cutoffSameAsStart, setCutoffSameAsStart] = useState(false);
  const [cutoffDirty, setCutoffDirty] = useState(false);

  const selectedItem = useMemo(() => catalogItems.find((x) => x.id === catalogItemId) || null, [catalogItems, catalogItemId]);

  const option1Values = useMemo(() => {
    const set = new Set<string>();
    for (const v of selectedItem?.variants || []) if (v?.option1) set.add(String(v.option1));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [selectedItem]);

  const option2Values = useMemo(() => {
    const set = new Set<string>();
    for (const v of selectedItem?.variants || []) if (v?.option2) set.add(String(v.option2));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [selectedItem]);

  const [option1Value, setOption1Value] = useState("");
  const [option2Value, setOption2Value] = useState("");

  useEffect(() => {
    setOption1Value("");
    setOption2Value("");
  }, [catalogItemId]);

  useEffect(() => {
    if (!startLocal) return;
    if (cutoffSameAsStart) {
      setCutoffLocal(startLocal);
      return;
    }
    if (cutoffDirty) return;
    setCutoffLocal(addIntervalLocal(startLocal, intervalUnit, Number(intervalCount || "1")));
  }, [startLocal, intervalUnit, intervalCount, cutoffSameAsStart, cutoffDirty]);

  const startAt = useMemo(() => toIsoFromLocalInput(startLocal), [startLocal]);
  const firstPeriodEndAt = useMemo(() => toIsoFromLocalInput(cutoffLocal), [cutoffLocal]);

  const summary = useMemo(() => {
    if (!selectedItem) return null;
    const base = Number(selectedItem.basePriceInCents || 0);
    const taxPercent = Number(selectedItem.taxPercent || 0);
    const discountType = String(selectedItem.discountType || "NONE");
    const discountValue = Number(selectedItem.discountValueInCents || 0);
    const discountPercent = Number(selectedItem.discountPercent || 0);

    let delta = 0;
    if (selectedItem.kind === "PRODUCT" && (selectedItem.variants || []).length > 0 && (option1Value || option2Value)) {
      const match = (selectedItem.variants || []).find(
        (v) => String(v.option1 || "") === String(option1Value || "") && String(v.option2 || "") === String(option2Value || "")
      );
      delta = match?.priceDeltaInCents ? Number(match.priceDeltaInCents) : 0;
    }

    let subtotal = base + delta;
    if (discountType === "FIXED") subtotal -= discountValue;
    else if (discountType === "PERCENT") subtotal -= Math.round((subtotal * discountPercent) / 100);
    if (subtotal < 0) subtotal = 0;
    const tax = Math.round((subtotal * taxPercent) / 100);
    const total = subtotal + tax;

    return { base, delta, subtotal, tax, total };
  }, [selectedItem, option1Value, option2Value]);

  const placeholderName = useMemo(() => {
    if (!selectedItem) return "Ej: Mensual";
    return `${tipo === "PLAN" ? "Plan" : "Suscripción"} - ${selectedItem.name}`;
  }, [selectedItem, tipo]);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3>Crear plan o suscripción</h3>
        <button type="button" className={open ? "ghost" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Nuevo"}
        </button>
      </div>

      {open ? (
        <form action={action} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Tipo</label>
              <select className="select" name="billingType" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                <option value="SUBSCRIPTION">Suscripción (cobro automático)</option>
                <option value="PLAN">Plan (link de pago)</option>
              </select>
              <div className="field-hint">
                {tipo === "PLAN"
                  ? "El sistema genera y envía un link de pago en cada corte (si la central está configurada)."
                  : "El sistema intenta cobrar automáticamente con el método tokenizado (si existe)."}
              </div>
            </div>

            <div className="field">
              <label>Contacto</label>
              {customers.length > 0 ? (
                <select className="select" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.email || c.name || c.id}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="field-hint">No hay contactos. Crea uno en “Contactos”.</div>
              )}
            </div>
          </div>

          <div className="field">
            <label>Nombre</label>
            <input className="input" name="name" placeholder={placeholderName} required />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Cada cuánto</label>
              <select className="select" name="intervalUnit" value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as any)}>
                <option value="DAY">Día</option>
                <option value="WEEK">Semana</option>
                <option value="MONTH">Mes</option>
                <option value="CUSTOM">Personalizado</option>
              </select>
            </div>
            <div className="field">
              <label>Cantidad</label>
              <input className="input" name="intervalCount" inputMode="numeric" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
            </div>
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
                onChange={(e) => {
                  setCutoffLocal(e.target.value);
                  setCutoffDirty(true);
                }}
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
                    setCutoffDirty(false);
                    if (v) setCutoffLocal(startLocal);
                  }}
                />
                <span>La fecha de corte es la misma que la activación</span>
              </label>
            </div>
          </div>

          <div className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Producto o servicio</label>
                {catalogItems.length > 0 ? (
                  <select className="select" name="catalogItemId" value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)} required>
                    {catalogItems.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name} ({p.kind === "SERVICE" ? "Servicio" : "Producto"})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="field-hint">No hay productos/servicios. Crea uno abajo.</div>
                )}
              </div>

              {selectedItem?.kind === "PRODUCT" && (selectedItem.variants || []).length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: selectedItem.option2Name ? "1fr 1fr" : "1fr", gap: 10 }}>
                  <div className="field">
                    <label>{selectedItem.option1Name || "Opción 1"}</label>
                    <select className="select" name="option1Value" value={option1Value} onChange={(e) => setOption1Value(e.target.value)}>
                      <option value="">Selecciona</option>
                      {option1Values.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedItem.option2Name ? (
                    <div className="field">
                      <label>{selectedItem.option2Name || "Opción 2"}</label>
                      <select className="select" name="option2Value" value={option2Value} onChange={(e) => setOption2Value(e.target.value)}>
                        <option value="">Selecciona</option>
                        {option2Values.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <input type="hidden" name="option2Value" value="" />
                  )}
                </div>
              ) : (
                <>
                  <input type="hidden" name="option1Value" value="" />
                  <input type="hidden" name="option2Value" value="" />
                </>
              )}

              {summary ? (
                <div className="field-hint" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span>Total a cobrar: <strong>{fmtMoneyFromCents(summary.total)}</strong></span>
                  <span style={{ color: "var(--muted)" }}>
                    base {fmtMoneyFromCents(summary.base)}
                    {summary.delta ? ` · variante ${fmtMoneyFromCents(summary.delta)}` : ""}
                    {Number(selectedItem?.taxPercent || 0) ? ` · impuesto ${selectedItem?.taxPercent}%` : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="primary" type="submit" disabled={!customers.length || !catalogItems.length}>
              Guardar
            </button>
          </div>
        </form>
      ) : (
        <div className="field-hint">Crea un plan (link) o una suscripción (cobro automático) y asígnale un producto/servicio.</div>
      )}
    </div>
  );
}

