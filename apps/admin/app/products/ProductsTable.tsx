"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { updateProduct } from "./actions";
import { HelpTip } from "../ui/HelpTip";
import { VariantsEditor } from "./VariantsEditor";

function formatCopCurrency(input: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function formatCopFromCents(cents: number) {
  const pesos = Math.trunc(Number(cents || 0) / 100);
  if (!Number.isFinite(pesos)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
}

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  basePriceInCents: number;
  taxPercent?: number;
  discountType?: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents?: number;
  discountPercent?: number;
  description?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string | null;
  unit?: string | null;
  requiresShipping?: boolean;
  option1Name?: string | null;
  option2Name?: string | null;
  variants?: Array<{ option1?: string | null; option2?: string | null; priceDeltaInCents: number }> | null;
};

export function ProductsTable({ items }: { items: ProductRow[] }) {
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState(false);

  const [kind, setKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState("");
  const [unit, setUnit] = useState("");
  const [priceCop, setPriceCop] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [discountType, setDiscountType] = useState<"NONE" | "FIXED" | "PERCENT">("NONE");
  const [discountCop, setDiscountCop] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [requiresShipping, setRequiresShipping] = useState(false);
  const [option1Name, setOption1Name] = useState("");
  const [option2Name, setOption2Name] = useState("");
  const [variantOptionsCount, setVariantOptionsCount] = useState<0 | 1 | 2>(0);
  const [variantsJson, setVariantsJson] = useState("[]");
  const modalRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  const showVariants = variantOptionsCount > 0 && kind === "PRODUCT";
  const showOption2 = showVariants && variantOptionsCount === 2;

  function openEditor(item: ProductRow) {
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    setEditing(item);
    setOpen(true);
    setKind(item.kind || "PRODUCT");
    setName(item.name || "");
    setSku(item.sku || "");
    setDescription(item.description || "");
    setVendor(item.vendor || "");
    setProductType(item.productType || "");
    setTags(item.tags || "");
    setUnit(item.unit || "");
    setPriceCop(formatCopFromCents(Number(item.basePriceInCents || 0)));
    setTaxPercent(String(item.taxPercent ?? 0));
    setDiscountType((item.discountType as any) || "NONE");
    setDiscountCop(formatCopFromCents(Number(item.discountValueInCents || 0)));
    setDiscountPercent(String(item.discountPercent ?? 0));
    setRequiresShipping(Boolean(item.requiresShipping));
    setOption1Name(item.option1Name || "");
    setOption2Name(item.option2Name || "");
    const hasOpt2 = Boolean(item.option2Name) || (item.variants || []).some((v) => v?.option2);
    const hasOpt1 = Boolean(item.option1Name) || (item.variants || []).some((v) => v?.option1);
    setVariantOptionsCount(hasOpt2 ? 2 : hasOpt1 ? 1 : 0);
    setVariantsJson(JSON.stringify(item.variants || []));
  }

  function closeEditor() {
    setOpen(false);
    setEditing(null);
    setTimeout(() => lastActiveRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    const el = modalRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
  }, [open]);

  function onModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeEditor();
      return;
    }
    if (e.key !== "Tab") return;
    const root = modalRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex]"))
      .filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const modalTitle = useMemo(() => (editing ? `Editar: ${editing.name}` : "Editar producto"), [editing]);

  return (
    <>
      <div className="panel module" style={{ padding: 0 }}>
        <table className="table" aria-label="Tabla de productos y servicios">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Precio</th>
              <th>IVA</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.kind === "SERVICE" ? "Servicio" : "Producto"}</td>
                <td>{formatCopFromCents(p.basePriceInCents)}</td>
                <td>{p.taxPercent ? `${p.taxPercent}%` : "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="ghost" type="button" onClick={() => openEditor(p)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: "var(--muted)" }}>
                  Sin productos/servicios.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {open && editing ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16
          }}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-edit-title"
            className="panel module"
            style={{ width: "min(980px, 96vw)", maxHeight: "90vh", overflow: "auto" }}
            onKeyDown={onModalKeyDown}
          >
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 id="product-edit-title" style={{ margin: 0 }}>{modalTitle}</h3>
              <button type="button" className="ghost" onClick={closeEditor}>
                Cerrar
              </button>
            </div>

            <form action={updateProduct} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="currency" value="COP" />

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>¿Es producto o servicio?</span>
                  <HelpTip text="Producto permite variantes y envío. Servicio no requiere envío." />
                </label>
                <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                  <option value="PRODUCT">Producto</option>
                  <option value="SERVICE">Servicio</option>
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Referencia / SKU</span>
                    <HelpTip text="Código único para identificar el ítem." />
                  </label>
                  <input className="input" name="sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
                </div>
              </div>

              <div className="field">
                <label>Descripción</label>
                <textarea className="input" name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Marca / Proveedor</label>
                  <input className="input" name="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
                </div>
                <div className="field">
                  <label>Categoría</label>
                  <input className="input" name="productType" value={productType} onChange={(e) => setProductType(e.target.value)} />
                </div>
                <div className="field">
                  <label>Etiquetas</label>
                  <input className="input" name="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Unidad</span>
                    <HelpTip text="Unidad de medida interna. Ej: UND, MES, HORA." />
                  </label>
                  <input className="input" name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Precio</span>
                    <HelpTip text="Precio base antes de impuestos/descuentos." />
                  </label>
                  <input
                    className="input"
                    name="basePricePesos"
                    inputMode="numeric"
                    value={priceCop}
                    onChange={(e) => setPriceCop(formatCopCurrency(e.target.value))}
                    required
                  />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{kind === "PRODUCT" ? "Requiere envío" : "Requiere envío (no aplica a servicios)"}</span>
                    <HelpTip text="Actívalo solo si el producto necesita logística de envío." />
                  </label>
                  <select
                    className="select"
                    name="requiresShipping"
                    value={requiresShipping ? "on" : ""}
                    onChange={(e) => setRequiresShipping(e.target.value === "on")}
                    disabled={kind === "SERVICE"}
                  >
                    <option value="">No</option>
                    <option value="on">Sí</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Impuesto</span>
                    <HelpTip text="Se aplica sobre el precio base." />
                  </label>
                  <select className="select" name="taxPercent" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)}>
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
                  <select className="select" name="discountType" value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}>
                    <option value="NONE">Sin descuento</option>
                    <option value="FIXED">Valor fijo</option>
                    <option value="PERCENT">Porcentaje</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Descuento (valor)</span>
                    <HelpTip text="Valor fijo en COP." />
                  </label>
                  <input
                    className="input"
                    name="discountValuePesos"
                    placeholder="$ 0"
                    inputMode="numeric"
                    value={discountCop}
                    onChange={(e) => setDiscountCop(formatCopCurrency(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Descuento (%)</span>
                    <HelpTip text="Porcentaje entre 0 y 100." />
                  </label>
                  <input className="input" name="discountPercent" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} inputMode="numeric" />
                </div>
              </div>

              <input type="hidden" name="taxable" value="on" />

              {kind === "PRODUCT" ? (
                <>
                  <div className="field">
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>Variantes</span>
                      <HelpTip text="Define opciones (ej: talla/color) y luego las combinaciones." />
                    </label>
                    <select
                      className="select"
                      value={variantOptionsCount}
                      onChange={(e) => setVariantOptionsCount(Number(e.target.value) as any)}
                    >
                      <option value={0}>Sin variantes</option>
                      <option value={1}>1 opción</option>
                      <option value={2}>2 opciones</option>
                    </select>
                  </div>

                  {showVariants ? (
                    <div style={{ display: "grid", gridTemplateColumns: showOption2 ? "1fr 1fr" : "1fr", gap: 10 }}>
                      <div className="field">
                        <label>{showOption2 ? "Opción 1" : "Nombre de opción"}</label>
                        <input className="input" name="option1Name" value={option1Name} onChange={(e) => setOption1Name(e.target.value)} />
                      </div>
                      {showOption2 ? (
                        <div className="field">
                          <label>Opción 2</label>
                          <input className="input" name="option2Name" value={option2Name} onChange={(e) => setOption2Name(e.target.value)} />
                        </div>
                      ) : (
                        <input type="hidden" name="option2Name" value="" />
                      )}
                    </div>
                  ) : (
                    <>
                      <input type="hidden" name="option1Name" value="" />
                      <input type="hidden" name="option2Name" value="" />
                    </>
                  )}

                  {showVariants ? (
                    <VariantsEditor
                      option1Name={option1Name || "Opción 1"}
                      option2Name={option2Name || "Opción 2"}
                      showOption2={showOption2}
                      disabled={!option1Name || (showOption2 && !option2Name)}
                      initialJson={variantsJson}
                      resetKey={editing.id}
                      onJsonChange={(json) => setVariantsJson(json)}
                    />
                  ) : (
                    <input type="hidden" name="variantsJson" value="[]" />
                  )}
                </>
              ) : (
                <>
                  <input type="hidden" name="requiresShipping" value="" />
                  <input type="hidden" name="option1Name" value="" />
                  <input type="hidden" name="option2Name" value="" />
                  <input type="hidden" name="variantsJson" value="[]" />
                </>
              )}

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="primary" type="submit">
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
