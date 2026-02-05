"use client";

import { useEffect, useMemo, useState } from "react";
import { VariantsEditor } from "../products/VariantsEditor";

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

function formatCopCurrencyInput(input: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function customerLabel(c: Customer) {
  const n = String(c.name || "").trim();
  const e = String(c.email || "").trim();
  if (n && e) return `${n} · ${e}`;
  return n || e || c.id;
}

export function NewPlanOrSubscriptionForm({
  action,
  customers,
  catalogItems,
  createCustomer,
  preselectCustomerId
}: {
  action: (formData: FormData) => void | Promise<void>;
  customers: Customer[];
  catalogItems: CatalogItem[];
  createCustomer: (formData: FormData) => void | Promise<void>;
  preselectCustomerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<"PLAN" | "SUBSCRIPCION">("SUBSCRIPCION");

  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState(preselectCustomerId || customers[0]?.id || "");
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const [catalogQ, setCatalogQ] = useState("");
  const [catalogMode, setCatalogMode] = useState<"EXISTING" | "NEW">(catalogItems.length ? "EXISTING" : "NEW");
  const [catalogItemId, setCatalogItemId] = useState(catalogItems[0]?.id || "");

  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");

  const [startLocal, setStartLocal] = useState(localNowString());
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [cutoffSameAsStart, setCutoffSameAsStart] = useState(false);
  const [cutoffDirty, setCutoffDirty] = useState(false);

  // Nombre del plan/suscripción
  const [name, setName] = useState("");

  // Nuevo producto/servicio (inline)
  const [itemKind, setItemKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [itemName, setItemName] = useState("");
  const [itemSku, setItemSku] = useState("");
  const [itemPriceCop, setItemPriceCop] = useState("");
  const [itemTaxPercent, setItemTaxPercent] = useState("0");
  const [itemDiscountType, setItemDiscountType] = useState<"NONE" | "FIXED" | "PERCENT">("NONE");
  const [itemDiscountCop, setItemDiscountCop] = useState("");
  const [itemDiscountPercent, setItemDiscountPercent] = useState("0");
  const [itemOption1Name, setItemOption1Name] = useState("");
  const [itemOption2Name, setItemOption2Name] = useState("");
  const [itemVariantsJson, setItemVariantsJson] = useState("[]");

  useEffect(() => {
    if (!preselectCustomerId) return;
    setCustomerId(preselectCustomerId);
    setOpen(true);
  }, [preselectCustomerId]);

  const selectedItem = useMemo(() => catalogItems.find((x) => x.id === catalogItemId) || null, [catalogItems, catalogItemId]);

  const parsedNewVariants = useMemo(() => {
    try {
      const v = JSON.parse(itemVariantsJson);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }, [itemVariantsJson]);

  const option1Values = useMemo(() => {
    const set = new Set<string>();
    const variants = catalogMode === "NEW" ? parsedNewVariants : selectedItem?.variants || [];
    for (const v of variants) if (v?.option1) set.add(String(v.option1));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [selectedItem, catalogMode, parsedNewVariants]);

  const option2Values = useMemo(() => {
    const set = new Set<string>();
    const variants = catalogMode === "NEW" ? parsedNewVariants : selectedItem?.variants || [];
    for (const v of variants) if (v?.option2) set.add(String(v.option2));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [selectedItem, catalogMode, parsedNewVariants]);

  const [option1Value, setOption1Value] = useState("");
  const [option2Value, setOption2Value] = useState("");

  useEffect(() => {
    setOption1Value("");
    setOption2Value("");
  }, [catalogItemId, catalogMode]);

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

  const filteredCustomers = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => customerLabel(c).toLowerCase().includes(q)).slice(0, 200);
  }, [customers, customerQ]);

  useEffect(() => {
    if (!filteredCustomers.length) return;
    if (filteredCustomers.some((c) => c.id === customerId)) return;
    setCustomerId(filteredCustomers[0].id);
  }, [filteredCustomers, customerId]);

  const filteredCatalogItems = useMemo(() => {
    const q = catalogQ.trim().toLowerCase();
    if (!q) return catalogItems;
    return catalogItems
      .filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [catalogItems, catalogQ]);

  useEffect(() => {
    if (catalogMode !== "EXISTING") return;
    if (!filteredCatalogItems.length) return;
    if (filteredCatalogItems.some((p) => p.id === catalogItemId)) return;
    setCatalogItemId(filteredCatalogItems[0].id);
  }, [catalogMode, filteredCatalogItems, catalogItemId]);

  const summary = useMemo(() => {
    const item = catalogMode === "NEW" ? null : selectedItem;
    if (catalogMode === "EXISTING" && !item) return null;

    const base =
      catalogMode === "NEW"
        ? Math.trunc(Number(String(itemPriceCop || "").replace(/[^\d]/g, "") || 0)) * 100
        : Number(item?.basePriceInCents || 0);
    const taxPercent = catalogMode === "NEW" ? Number(itemTaxPercent || 0) : Number(item?.taxPercent || 0);
    const discountType = catalogMode === "NEW" ? String(itemDiscountType || "NONE") : String(item?.discountType || "NONE");
    const discountValue =
      catalogMode === "NEW"
        ? Math.trunc(Number(String(itemDiscountCop || "").replace(/[^\d]/g, "") || 0)) * 100
        : Number(item?.discountValueInCents || 0);
    const discountPercent = catalogMode === "NEW" ? Number(itemDiscountPercent || 0) : Number(item?.discountPercent || 0);

    let delta = 0;
    const itemKindForDelta = catalogMode === "NEW" ? itemKind : (item?.kind as any);
    const variantsForDelta = catalogMode === "NEW" ? parsedNewVariants : item?.variants || [];
    if (itemKindForDelta === "PRODUCT" && (variantsForDelta || []).length > 0 && (option1Value || option2Value)) {
      const match = (variantsForDelta || []).find(
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
  }, [
    catalogMode,
    selectedItem,
    parsedNewVariants,
    itemKind,
    itemPriceCop,
    itemTaxPercent,
    itemDiscountType,
    itemDiscountCop,
    itemDiscountPercent,
    option1Value,
    option2Value
  ]);

  const defaultName = useMemo(() => {
    if (catalogMode === "NEW") return `${tipo === "PLAN" ? "Plan" : "Suscripción"} - ${itemName || "Nuevo"}`;
    if (!selectedItem) return `${tipo === "PLAN" ? "Plan" : "Suscripción"}`;
    return `${tipo === "PLAN" ? "Plan" : "Suscripción"} - ${selectedItem.name}`;
  }, [catalogMode, selectedItem, tipo, itemName]);

  useEffect(() => {
    if (name) return;
    setName(defaultName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultName]);

  const showVariantSelectors = useMemo(() => {
    const kind = catalogMode === "NEW" ? itemKind : selectedItem?.kind;
    if (kind !== "PRODUCT") return false;
    const option1Name = catalogMode === "NEW" ? itemOption1Name : selectedItem?.option1Name;
    const option2Name = catalogMode === "NEW" ? itemOption2Name : selectedItem?.option2Name;
    const hasAnyVariants = (catalogMode === "NEW" ? parsedNewVariants : selectedItem?.variants || []).length > 0;
    return !!hasAnyVariants && !!(option1Name || option2Name);
  }, [catalogMode, itemKind, selectedItem, itemOption1Name, itemOption2Name, parsedNewVariants]);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3>Crear plan o suscripción</h3>
        <button type="button" className={open ? "btnLink" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear nuevo"}
        </button>
      </div>

      {open ? (
        <div style={{ display: "grid", gap: 12 }}>
          <form action={action} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>Tipo</label>
                <select className="select" name="billingType" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                  <option value="PLAN">Plan (link de pago)</option>
                  <option value="SUBSCRIPCION">Suscripción (cobro automático)</option>
                </select>
                <div className="field-hint">
                  {tipo === "SUBSCRIPCION"
                    ? "Cobro tokenizado. Si el contacto no tiene método de pago, se genera un link y se envía por la central de comunicaciones."
                    : "Se genera un link de pago en la fecha de corte y se envía por la central de comunicaciones (si está configurada)."}
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
              <label>Nombre</label>
              <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} required />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>Frecuencia</label>
                <select className="select" name="intervalUnit" value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as any)}>
                  <option value="DAY">Día</option>
                  <option value="WEEK">Semana</option>
                  <option value="MONTH">Mes</option>
                  <option value="CUSTOM">Personalizado</option>
                </select>
              </div>
              <div className="field">
                <label>Cada</label>
                <input className="input" name="intervalCount" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} inputMode="numeric" />
              </div>
              <div className="field">
                <label>Moneda</label>
                <input className="input" value="COP" readOnly />
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
                      setCutoffDirty(true);
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
                  <label>Producto / Servicio</label>
                  <select className="select" name="catalogMode" value={catalogMode} onChange={(e) => setCatalogMode(e.target.value as any)}>
                    <option value="EXISTING">Elegir existente</option>
                    <option value="NEW">Crear nuevo</option>
                  </select>
                </div>

                {catalogMode === "EXISTING" ? (
                  <div className="field">
                    <label>Catálogo</label>
                    <input className="input" placeholder="Buscar..." value={catalogQ} onChange={(e) => setCatalogQ(e.target.value)} />
                    <select className="select" name="catalogItemId" value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)} required>
                      {filteredCatalogItems.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.sku}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <input type="hidden" name="catalogItemId" value="" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>Tipo de ítem</label>
                        <select className="select" name="itemKind" value={itemKind} onChange={(e) => setItemKind(e.target.value as any)}>
                          <option value="PRODUCT">Producto</option>
                          <option value="SERVICE">Servicio</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Precio</label>
                        <input
                          className="input"
                          name="itemBasePricePesos"
                          inputMode="numeric"
                          value={itemPriceCop}
                          onChange={(e) => setItemPriceCop(formatCopCurrencyInput(e.target.value))}
                          placeholder="$ 150.500"
                          required
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>Nombre del ítem</label>
                        <input className="input" name="itemName" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
                      </div>
                      <div className="field">
                        <label>SKU</label>
                        <input className="input" name="itemSku" value={itemSku} onChange={(e) => setItemSku(e.target.value)} required />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>Impuesto</label>
                        <select className="select" name="itemTaxPercent" value={itemTaxPercent} onChange={(e) => setItemTaxPercent(e.target.value)}>
                          <option value="0">Sin impuesto</option>
                          <option value="19">IVA 19%</option>
                          <option value="8">Consumo 8%</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Descuento</label>
                        <select className="select" name="itemDiscountType" value={itemDiscountType} onChange={(e) => setItemDiscountType(e.target.value as any)}>
                          <option value="NONE">Sin descuento</option>
                          <option value="FIXED">Valor fijo</option>
                          <option value="PERCENT">Porcentaje</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>{itemDiscountType === "PERCENT" ? "Descuento (%)" : "Descuento (valor)"}</label>
                        {itemDiscountType === "PERCENT" ? (
                          <input className="input" name="itemDiscountPercent" value={itemDiscountPercent} onChange={(e) => setItemDiscountPercent(e.target.value)} inputMode="numeric" />
                        ) : (
                          <input
                            className="input"
                            name="itemDiscountValuePesos"
                            value={itemDiscountCop}
                            onChange={(e) => setItemDiscountCop(formatCopCurrencyInput(e.target.value))}
                            inputMode="numeric"
                            placeholder="$ 0"
                          />
                        )}
                      </div>
                    </div>

                    {itemDiscountType !== "PERCENT" ? (
                      <input type="hidden" name="itemDiscountPercent" value={itemDiscountPercent} />
                    ) : (
                      <input type="hidden" name="itemDiscountValuePesos" value={itemDiscountCop} />
                    )}

                    {itemKind === "PRODUCT" ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div className="field">
                            <label>Opción 1 (opcional)</label>
                            <input className="input" name="itemOption1Name" value={itemOption1Name} onChange={(e) => setItemOption1Name(e.target.value)} placeholder="Ej: Talla" />
                          </div>
                          <div className="field">
                            <label>Opción 2 (opcional)</label>
                            <input className="input" name="itemOption2Name" value={itemOption2Name} onChange={(e) => setItemOption2Name(e.target.value)} placeholder="Ej: Color" />
                          </div>
                        </div>

                        <div className="field">
                          <label>Variantes</label>
                          <VariantsEditor
                            option1Name={itemOption1Name}
                            option2Name={itemOption2Name}
                            showOption2={!!itemOption2Name.trim()}
                            disabled={!itemOption1Name.trim()}
                            fieldName="itemVariantsJson"
                            onJsonChange={setItemVariantsJson}
                          />
                          <div className="field-hint">Si no usas variantes, déjalo vacío.</div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <input type="hidden" name="itemOption1Name" value="" />
                        <input type="hidden" name="itemOption2Name" value="" />
                        <input type="hidden" name="itemVariantsJson" value="[]" />
                      </>
                    )}
                  </>
                )}

                <input type="hidden" name="option1Value" value={option1Value} />
                <input type="hidden" name="option2Value" value={option2Value} />

                {showVariantSelectors && (catalogMode === "EXISTING" ? selectedItem?.kind === "PRODUCT" : itemKind === "PRODUCT") ? (
                  <div style={{ display: "grid", gridTemplateColumns: option2Values.length ? "1fr 1fr" : "1fr", gap: 10 }}>
                    <div className="field">
                      <label>{catalogMode === "NEW" ? itemOption1Name || "Opción 1" : selectedItem?.option1Name || "Opción 1"}</label>
                      <select className="select" value={option1Value} onChange={(e) => setOption1Value(e.target.value)}>
                        <option value="">Selecciona</option>
                        {option1Values.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                    {option2Values.length ? (
                      <div className="field">
                        <label>{catalogMode === "NEW" ? itemOption2Name || "Opción 2" : selectedItem?.option2Name || "Opción 2"}</label>
                        <select className="select" value={option2Value} onChange={(e) => setOption2Value(e.target.value)}>
                          <option value="">Selecciona</option>
                          {option2Values.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {summary ? (
                  <div className="card cardPad" style={{ background: "rgba(15, 23, 42, 0.03)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--muted)" }}>Total estimado</span>
                      <strong>{fmtMoneyFromCents(summary.total)}</strong>
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      Base: {fmtMoneyFromCents(summary.base)} · Variantes: {fmtMoneyFromCents(summary.delta)} · Impuesto: {fmtMoneyFromCents(summary.tax)}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="primary" type="submit" disabled={!filteredCustomers.length || (catalogMode === "EXISTING" && !filteredCatalogItems.length)}>
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
        <div className="field-hint">Crea un plan o una suscripción, amarrado a un producto/servicio, y asígnalo a un contacto.</div>
      )}
    </div>
  );
}
