"use client";

import { useEffect, useMemo, useState } from "react";
import { VariantsEditor } from "./VariantsEditor";

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
  const [catalogMode, setCatalogMode] = useState<"EXISTING" | "NEW">(catalogItems.length ? "EXISTING" : "NEW");
  const [catalogItemId, setCatalogItemId] = useState(catalogItems[0]?.id || "");

  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");

  const [startLocal, setStartLocal] = useState(localNowString());
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [cutoffSameAsStart, setCutoffSameAsStart] = useState(false);
  const [cutoffDirty, setCutoffDirty] = useState(false);

  // New catalog item (inline)
  const [itemKind, setItemKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [itemName, setItemName] = useState("");
  const [itemSku, setItemSku] = useState("");
  const [itemPriceCop, setItemPriceCop] = useState("");
  const [itemTaxPercent, setItemTaxPercent] = useState("0");
  const [itemDiscountType, setItemDiscountType] = useState<"NONE" | "FIXED" | "PERCENT">("NONE");
  const [itemDiscountCop, setItemDiscountCop] = useState("");
  const [itemDiscountPercent, setItemDiscountPercent] = useState("0");
  const [itemVariantOptionsCount, setItemVariantOptionsCount] = useState<0 | 1 | 2>(0);
  const [itemOption1Name, setItemOption1Name] = useState("");
  const [itemOption2Name, setItemOption2Name] = useState("");
  const [itemVariantsJson, setItemVariantsJson] = useState("[]");

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
    const item = catalogMode === "NEW" ? null : selectedItem;
    if (catalogMode === "EXISTING" && !item) return null;

    const base = catalogMode === "NEW" ? Math.trunc(Number(String(itemPriceCop || "").replace(/[^\d]/g, "") || 0)) * 100 : Number(item?.basePriceInCents || 0);
    const taxPercent = catalogMode === "NEW" ? Number(itemTaxPercent || 0) : Number(item?.taxPercent || 0);
    const discountType = catalogMode === "NEW" ? String(itemDiscountType || "NONE") : String(item?.discountType || "NONE");
    const discountValue =
      catalogMode === "NEW" ? Math.trunc(Number(String(itemDiscountCop || "").replace(/[^\d]/g, "") || 0)) * 100 : Number(item?.discountValueInCents || 0);
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

  const placeholderName = useMemo(() => {
    if (catalogMode === "NEW") return `${tipo === "PLAN" ? "Plan" : "Suscripción"} - ${itemName || "Nuevo"}`;
    if (!selectedItem) return "Ej: Mensual";
    return `${tipo === "PLAN" ? "Plan" : "Suscripción"} - ${selectedItem.name}`;
  }, [catalogMode, selectedItem, tipo, itemName]);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3>Crear plan o suscripción</h3>
        <button type="button" className={open ? "ghost" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear plan o suscripción"}
        </button>
      </div>

      {open ? (
        <form action={action} style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="catalogMode" value={catalogMode} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Tipo</label>
              <select className="select" name="billingType" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                <option value="SUBSCRIPTION">Suscripción (cobro automático)</option>
                <option value="PLAN">Plan (link de pago)</option>
              </select>
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
                <select className="select" value={catalogMode} onChange={(e) => setCatalogMode(e.target.value as any)}>
                  <option value="EXISTING">Elegir existente</option>
                  <option value="NEW">Crear nuevo</option>
                </select>
              </div>

              {catalogMode === "EXISTING" ? (
                <>
                  {catalogItems.length > 0 ? (
                    <select className="select" name="catalogItemId" value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)} required>
                      {catalogItems.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name} ({p.kind === "SERVICE" ? "Servicio" : "Producto"})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="field-hint">No hay productos/servicios. Cambia a “Crear nuevo”.</div>
                  )}

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
                </>
              ) : (
                <>
                  <input type="hidden" name="catalogItemId" value="" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>¿Es producto o servicio?</label>
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
                      <label>Nombre</label>
                      <input className="input" name="itemName" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
                    </div>
                    <div className="field">
                      <label>Referencia / SKU</label>
                      <input className="input" name="itemSku" value={itemSku} onChange={(e) => setItemSku(e.target.value)} required />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Descuento (valor)</label>
                      <input
                        className="input"
                        name="itemDiscountValuePesos"
                        inputMode="numeric"
                        value={itemDiscountCop}
                        onChange={(e) => setItemDiscountCop(formatCopCurrencyInput(e.target.value))}
                        placeholder="$ 0"
                      />
                    </div>
                    <div className="field">
                      <label>Descuento (%)</label>
                      <input className="input" name="itemDiscountPercent" inputMode="numeric" value={itemDiscountPercent} onChange={(e) => setItemDiscountPercent(e.target.value)} />
                    </div>
                  </div>

                  {itemKind === "PRODUCT" ? (
                    <>
                      <div className="field">
                        <label>Variantes</label>
                        <select
                          className="select"
                          name="itemVariantOptionsCount"
                          value={itemVariantOptionsCount}
                          onChange={(e) => {
                            const next = Number(e.target.value) as any;
                            setItemVariantOptionsCount(next);
                            if (next === 0) {
                              setItemVariantsJson("[]");
                              setOption1Value("");
                              setOption2Value("");
                            }
                          }}
                        >
                          <option value={0}>Sin variantes</option>
                          <option value={1}>1 opción</option>
                          <option value={2}>2 opciones</option>
                        </select>
                      </div>

                      {itemVariantOptionsCount > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: itemVariantOptionsCount === 2 ? "1fr 1fr" : "1fr", gap: 10 }}>
                          <div className="field">
                            <label>Opción 1</label>
                            <input className="input" name="itemOption1Name" value={itemOption1Name} onChange={(e) => setItemOption1Name(e.target.value)} placeholder="Ej: Talla" required />
                          </div>
                          {itemVariantOptionsCount === 2 ? (
                            <div className="field">
                              <label>Opción 2</label>
                              <input className="input" name="itemOption2Name" value={itemOption2Name} onChange={(e) => setItemOption2Name(e.target.value)} placeholder="Ej: Color" required />
                            </div>
                          ) : (
                            <input type="hidden" name="itemOption2Name" value="" />
                          )}
                        </div>
                      ) : (
                        <>
                          <input type="hidden" name="itemOption1Name" value="" />
                          <input type="hidden" name="itemOption2Name" value="" />
                        </>
                      )}

                      {itemVariantOptionsCount > 0 ? (
                        <VariantsEditor
                          option1Name={itemOption1Name}
                          option2Name={itemOption2Name}
                          showOption2={itemVariantOptionsCount === 2}
                          disabled={!itemOption1Name.trim() || (itemVariantOptionsCount === 2 && !itemOption2Name.trim())}
                          fieldName="itemVariantsJson"
                          onJsonChange={(json) => setItemVariantsJson(json)}
                        />
                      ) : (
                        <input type="hidden" name="itemVariantsJson" value="[]" />
                      )}

                      {(parsedNewVariants || []).length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: itemVariantOptionsCount === 2 ? "1fr 1fr" : "1fr", gap: 10 }}>
                          <div className="field">
                            <label>{itemOption1Name || "Opción 1"}</label>
                            <select className="select" name="option1Value" value={option1Value} onChange={(e) => setOption1Value(e.target.value)}>
                              <option value="">Selecciona</option>
                              {option1Values.map((v) => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </div>
                          {itemVariantOptionsCount === 2 ? (
                            <div className="field">
                              <label>{itemOption2Name || "Opción 2"}</label>
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
                    </>
                  ) : (
                    <>
                      <input type="hidden" name="itemVariantOptionsCount" value="0" />
                      <input type="hidden" name="itemOption1Name" value="" />
                      <input type="hidden" name="itemOption2Name" value="" />
                      <input type="hidden" name="itemVariantsJson" value="[]" />
                      <input type="hidden" name="option1Value" value="" />
                      <input type="hidden" name="option2Value" value="" />
                    </>
                  )}
                </>
              )}

              {summary ? (
                <div className="field-hint" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span>Total a cobrar: <strong>{fmtMoneyFromCents(summary.total)}</strong></span>
                  <span style={{ color: "var(--muted)" }}>
                    base {fmtMoneyFromCents(summary.base)}
                    {summary.delta ? ` · variante ${fmtMoneyFromCents(summary.delta)}` : ""}
                    {catalogMode === "NEW"
                      ? Number(itemTaxPercent || 0)
                        ? ` · impuesto ${itemTaxPercent}%`
                        : ""
                      : Number(selectedItem?.taxPercent || 0)
                        ? ` · impuesto ${selectedItem?.taxPercent}%`
                        : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="primary" type="submit" disabled={!customers.length || (catalogMode === "EXISTING" && !catalogItems.length)}>
              Guardar
            </button>
          </div>
        </form>
      ) : (
        <div className="field-hint">Crea un plan o una suscripción y asigna el producto/servicio.</div>
      )}
    </div>
  );
}
