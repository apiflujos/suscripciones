"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VariantsEditor } from "./VariantsEditor";
import { enterToNextField } from "../lib/enterToNext";
import { HelpTip } from "../ui/HelpTip";

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
  catalogItems
}: {
  action: (formData: FormData) => void | Promise<void>;
  catalogItems: CatalogItem[];
}) {
  const [open, setOpen] = useState(false);
  const tipoRef = useRef<HTMLSelectElement | null>(null);

  const [tipo, setTipo] = useState<"PLAN" | "SUBSCRIPCION">("SUBSCRIPCION");
  const [name, setName] = useState("");
  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");

  const [catalogMode, setCatalogMode] = useState<"EXISTING" | "NEW">(catalogItems.length ? "EXISTING" : "NEW");
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogItemId, setCatalogItemId] = useState(catalogItems[0]?.id || "");
  const [catalogHits, setCatalogHits] = useState<CatalogItem[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogSearchError, setCatalogSearchError] = useState("");
  const [selectedCatalogOverride, setSelectedCatalogOverride] = useState<CatalogItem | null>(null);

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

  const catalogPool = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const it of catalogItems) map.set(String(it.id), it);
    for (const it of catalogHits) map.set(String(it.id), it);
    if (selectedCatalogOverride) map.set(String(selectedCatalogOverride.id), selectedCatalogOverride);
    return Array.from(map.values());
  }, [catalogHits, catalogItems, selectedCatalogOverride]);

  const selectedItem = useMemo(
    () => catalogPool.find((x) => String(x.id) === String(catalogItemId)) || null,
    [catalogPool, catalogItemId]
  );

  const filteredCatalogItems = useMemo(() => {
    const q = catalogQ.trim().toLowerCase();
    let list: CatalogItem[];

    if (q.length >= 2) {
      list = catalogHits.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es")).slice(0, 200);
      if (selectedItem && !list.some((x) => String(x.id) === String(selectedItem.id))) return [selectedItem, ...list];
      return list;
    }

    if (!q) {
      list = catalogPool.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es")).slice(0, 200);
    } else {
      list = catalogPool
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"))
        .filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q))
        .slice(0, 200);
    }

    if (selectedItem && !list.some((x) => String(x.id) === String(selectedItem.id))) return [selectedItem, ...list];
    return list;
  }, [catalogHits, catalogPool, catalogQ, selectedItem]);

  useEffect(() => {
    const q = catalogQ.trim();
    if (!open || catalogMode !== "EXISTING" || q.length < 2) {
      setCatalogHits([]);
      setCatalogSearching(false);
      setCatalogSearchError("");
      return;
    }

    const ac = new AbortController();
    setCatalogSearching(true);
    setCatalogSearchError("");
    const t = setTimeout(() => {
      fetch(`/api/search/products?${new URLSearchParams({ q, take: "120" }).toString()}`, { cache: "no-store", signal: ac.signal })
        .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }))
        .then(({ ok, status, json }) => {
          if (!ok) {
            setCatalogHits([]);
            setCatalogSearchError(status === 401 ? "No autorizado (revisa el token del Admin)." : `Error buscando productos (${status}).`);
            return;
          }
          const items = Array.isArray(json?.items) ? (json.items as CatalogItem[]) : [];
          setCatalogHits(items);
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          setCatalogHits([]);
          setCatalogSearchError("Error de red buscando productos.");
        })
        .finally(() => {
          if (ac.signal.aborted) return;
          setCatalogSearching(false);
        });
    }, 250);

    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [catalogMode, catalogQ, open]);

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
    if (!open) return;
    const t = setTimeout(() => tipoRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const showVariantSelectors = useMemo(() => {
    const kind = catalogMode === "NEW" ? itemKind : selectedItem?.kind;
    if (kind !== "PRODUCT") return false;
    const option1Name = catalogMode === "NEW" ? itemOption1Name : selectedItem?.option1Name;
    const option2Name = catalogMode === "NEW" ? itemOption2Name : selectedItem?.option2Name;
    const hasAnyVariants = (catalogMode === "NEW" ? parsedNewVariants : selectedItem?.variants || []).length > 0;
    return !!hasAnyVariants && !!(option1Name || option2Name);
  }, [catalogMode, itemKind, selectedItem, itemOption1Name, itemOption2Name, parsedNewVariants]);

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

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3>Crear plan o suscripción</h3>
          <HelpTip text="Aquí creas la plantilla (sin contacto) y la amarras a un producto/servicio." />
        </div>
        <button type="button" className={open ? "btnLink" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cerrar" : "Crear nuevo"}
        </button>
      </div>

      {open ? (
        <form action={action} onKeyDownCapture={enterToNextField} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Tipo</span>
                <HelpTip text="Plan = link de pago. Suscripción = cobro automático." />
              </label>
              <select ref={tipoRef} className="select" name="billingType" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                <option value="PLAN">Plan (link de pago)</option>
                <option value="SUBSCRIPCION">Suscripción (cobro automático)</option>
              </select>
            </div>
            <div className="field">
              <label>Nombre</label>
              <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Suscripción mensual" required />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Frecuencia</span>
                <HelpTip text="Unidad del cobro recurrente." />
              </label>
              <select className="select" name="intervalUnit" value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as any)}>
                <option value="DAY">Día</option>
                <option value="WEEK">Semana</option>
                <option value="MONTH">Mes</option>
                <option value="CUSTOM">Personalizado</option>
              </select>
            </div>
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Cada</span>
                <HelpTip text="Cantidad de unidades por ciclo. Ej: cada 2 semanas." />
              </label>
              <input className="input" name="intervalCount" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} inputMode="numeric" />
            </div>
          </div>

          <div className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <strong>Producto / Servicio (amarrado al plan)</strong>
                <HelpTip text="Este ítem define el precio (con impuestos/descuentos/variantes) que se cobrará o se enviará por link." />
              </div>

              <div className="field">
                <select
                  className="select"
                  name="catalogMode"
                  aria-label="Elegir producto/servicio existente o crear uno nuevo"
                  value={catalogMode}
                  onChange={(e) => {
                    const mode = e.target.value as any;
                    setCatalogMode(mode);
                    setCatalogQ("");
                    setCatalogHits([]);
                    setCatalogSearching(false);
                    if (mode !== "EXISTING") setSelectedCatalogOverride(null);
                  }}
                >
                  <option value="EXISTING">Elegir existente</option>
                  <option value="NEW">Crear nuevo</option>
                </select>
              </div>

              {catalogMode === "EXISTING" ? (
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Catálogo</span>
                    <HelpTip text="Busca y selecciona un producto/servicio existente." />
                  </label>
                  <input className="input" placeholder="Buscar..." value={catalogQ} onChange={(e) => setCatalogQ(e.target.value)} aria-label="Buscar catálogo" />
                  {catalogSearching ? <div className="field-hint">Buscando…</div> : null}
                  {catalogSearchError ? <div className="field-hint" style={{ color: "rgba(217, 83, 79, 0.92)" }}>{catalogSearchError}</div> : null}
                  <select
                    className="select"
                    name="catalogItemId"
                    value={catalogItemId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setCatalogItemId(id);
                      const picked = catalogPool.find((x) => String(x.id) === String(id)) || null;
                      setSelectedCatalogOverride(picked);
                    }}
                    required
                  >
                    {filteredCatalogItems.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.sku}
                      </option>
                    ))}
                  </select>
                  {!catalogSearching && catalogQ.trim().length >= 2 && filteredCatalogItems.length === 0 ? (
                    <div className="field-hint">Sin resultados. Prueba con otro término.</div>
                  ) : null}
                </div>
              ) : (
                <>
                  <input type="hidden" name="catalogItemId" value="" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>Tipo de ítem</span>
                        <HelpTip text="Producto tiene inventario/variantes; servicio no." />
                      </label>
                      <select className="select" name="itemKind" value={itemKind} onChange={(e) => setItemKind(e.target.value as any)}>
                        <option value="PRODUCT">Producto</option>
                        <option value="SERVICE">Servicio</option>
                      </select>
                    </div>
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>Precio</span>
                        <HelpTip text="Precio base antes de impuestos/descuentos." />
                      </label>
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
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>SKU</span>
                        <HelpTip text="Identificador único del ítem." />
                      </label>
                      <input className="input" name="itemSku" value={itemSku} onChange={(e) => setItemSku(e.target.value)} required />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>Impuesto</span>
                        <HelpTip text="Se aplica sobre el precio base." />
                      </label>
                      <select className="select" name="itemTaxPercent" value={itemTaxPercent} onChange={(e) => setItemTaxPercent(e.target.value)}>
                        <option value="0">Sin impuesto</option>
                        <option value="19">IVA 19%</option>
                        <option value="8">Consumo 8%</option>
                      </select>
                    </div>
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>Descuento</span>
                        <HelpTip text="Elige si el descuento es fijo o porcentual." />
                      </label>
                      <select className="select" name="itemDiscountType" value={itemDiscountType} onChange={(e) => setItemDiscountType(e.target.value as any)}>
                        <option value="NONE">Sin descuento</option>
                        <option value="FIXED">Valor fijo</option>
                        <option value="PERCENT">Porcentaje</option>
                      </select>
                    </div>
                    <div className="field">
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{itemDiscountType === "PERCENT" ? "Descuento (%)" : "Descuento (valor)"}</span>
                        <HelpTip text="Si es porcentaje, usa 0-100. Si es valor, en COP." />
                      </label>
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
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>Opción 1 (opcional)</span>
                            <HelpTip text="Nombre de la primera variante. Ej: Talla." />
                          </label>
                          <input className="input" name="itemOption1Name" value={itemOption1Name} onChange={(e) => setItemOption1Name(e.target.value)} placeholder="Ej: Talla" />
                        </div>
                        <div className="field">
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>Opción 2 (opcional)</span>
                            <HelpTip text="Nombre de la segunda variante. Ej: Color." />
                          </label>
                          <input className="input" name="itemOption2Name" value={itemOption2Name} onChange={(e) => setItemOption2Name(e.target.value)} placeholder="Ej: Color" />
                        </div>
                      </div>

                      <div className="field">
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span>Variantes</span>
                          <HelpTip text="Si no usas variantes, puedes dejar esta sección vacía." />
                        </label>
                        <VariantsEditor
                          option1Name={itemOption1Name}
                          option2Name={itemOption2Name}
                          showOption2={!!itemOption2Name.trim()}
                          disabled={!itemOption1Name.trim()}
                          fieldName="itemVariantsJson"
                          onJsonChange={setItemVariantsJson}
                        />
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

              {showVariantSelectors ? (
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
                    <span style={{ color: "var(--muted)" }}>Total del plan</span>
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
            <button className="primary" type="submit">
              Guardar
            </button>
          </div>
        </form>
      ) : (
        null
      )}
    </div>
  );
}
