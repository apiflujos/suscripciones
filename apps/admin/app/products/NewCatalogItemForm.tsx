"use client";

import { useMemo, useState } from "react";
import { VariantsEditor } from "./VariantsEditor";

function formatCopCurrency(input: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

export function NewCatalogItemForm({
  action
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [show, setShow] = useState(false);
  const [variantOptionsCount, setVariantOptionsCount] = useState<0 | 1 | 2>(0);
  const [option1Name, setOption1Name] = useState("");
  const [option2Name, setOption2Name] = useState("");
  const [priceCop, setPriceCop] = useState("");
  const [discountCop, setDiscountCop] = useState("");

  const hasVariants = useMemo(() => kind === "PRODUCT" && variantOptionsCount > 0, [kind, variantOptionsCount]);
  const showOption2 = useMemo(() => hasVariants && variantOptionsCount === 2, [hasVariants, variantOptionsCount]);

  return (
    <div className="panel module">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3>Productos y Servicios</h3>
        <button type="button" className="btn btnPrimary" onClick={() => setShow((v) => !v)}>
          {show ? "Cerrar" : "Nuevo producto/servicio"}
        </button>
      </div>

      {show ? (
        <form action={action} style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label>¿Es producto o servicio?</label>
            <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="PRODUCT">PRODUCTO</option>
              <option value="SERVICE">SERVICIO</option>
            </select>
          </div>

          <input type="hidden" name="currency" value="COP" />

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Nombre</label>
              <input className="input" name="name" placeholder={kind === "SERVICE" ? "Ej: Membresía VIP" : "Ej: Zapato Olivia"} required />
            </div>
            <div className="field">
              <label>Referencia / SKU</label>
              <input className="input" name="sku" placeholder="OLIVIA-001" required />
            </div>
          </div>

          <div className="field">
            <label>Descripción</label>
            <textarea className="input" name="description" rows={3} placeholder="Describe el producto o servicio (opcional)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Marca / Proveedor</label>
              <input className="input" name="vendor" placeholder="Ej: Olivia Shoes" />
            </div>
            <div className="field">
              <label>Categoría</label>
              <input className="input" name="productType" placeholder="Ej: Calzado" />
            </div>
            <div className="field">
              <label>Etiquetas</label>
              <input className="input" name="tags" placeholder="Ej: nueva, hombre, premium" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Unidad</label>
              <input className="input" name="unit" placeholder="Ej: UND" />
            </div>
            <div className="field">
              <label>Precio</label>
              <input
                className="input"
                name="basePricePesos"
                inputMode="numeric"
                value={priceCop}
                onChange={(e) => setPriceCop(formatCopCurrency(e.target.value))}
                placeholder="$ 150.500"
                required
              />
            </div>
            <div className="field">
              <label>{kind === "PRODUCT" ? "Requiere envío" : "Requiere envío (no aplica a servicios)"}</label>
              <select className="select" name="requiresShipping" defaultValue={kind === "PRODUCT" ? "on" : ""} disabled={kind === "SERVICE"}>
                <option value="">No</option>
                <option value="on">Sí</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Impuesto</label>
              <select className="select" name="taxPercent" defaultValue="0">
                <option value="0">Sin impuesto</option>
                <option value="19">IVA 19%</option>
                <option value="8">Consumo 8%</option>
              </select>
            </div>
            <div className="field">
              <label>Descuento</label>
              <select className="select" name="discountType" defaultValue="NONE">
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
                name="discountValuePesos"
                placeholder="$ 0"
                inputMode="numeric"
                value={discountCop}
                onChange={(e) => setDiscountCop(formatCopCurrency(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Descuento (%)</label>
              <input className="input" name="discountPercent" placeholder="0" inputMode="numeric" />
            </div>
          </div>

          <input type="hidden" name="taxable" value="on" />

          {kind === "PRODUCT" ? (
            <>
              <div className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="field">
                    <label>Variantes</label>
                    <select
                      className="select"
                      value={variantOptionsCount}
                      onChange={(e) => setVariantOptionsCount(Number(e.target.value) as any)}
                    >
                      <option value={0}>Sin variantes</option>
                      <option value={1}>1 opción</option>
                      <option value={2}>2 opciones</option>
                    </select>
                    <div className="field-hint">Primero define las opciones; luego agrega las variantes.</div>
                  </div>
                </div>
              </div>

              {hasVariants ? (
                <div style={{ display: "grid", gridTemplateColumns: showOption2 ? "1fr 1fr" : "1fr", gap: 10 }}>
                  <div className="field">
                    <label>Opción 1</label>
                    <input
                      className="input"
                      name="option1Name"
                      value={option1Name}
                      onChange={(e) => setOption1Name(e.target.value)}
                      placeholder="Ej: Talla"
                      required={hasVariants}
                    />
                  </div>
                  {showOption2 ? (
                    <div className="field">
                      <label>Opción 2</label>
                      <input
                        className="input"
                        name="option2Name"
                        value={option2Name}
                        onChange={(e) => setOption2Name(e.target.value)}
                        placeholder="Ej: Color"
                        required={showOption2}
                      />
                    </div>
                  ) : (
                    <input type="hidden" name="option2Name" value="" />
                  )}
                </div>
              ) : (
                <>
                  <input type="hidden" name="option1Name" value="" />
                  <input type="hidden" name="option2Name" value="" />
                  <input type="hidden" name="variantsJson" value="[]" />
                </>
              )}

              {hasVariants ? (
                <VariantsEditor option1Name={option1Name} option2Name={showOption2 ? option2Name : ""} disabled={!option1Name.trim() || (showOption2 && !option2Name.trim())} />
              ) : null}
            </>
          ) : (
            <>
              <input type="hidden" name="option1Name" value="" />
              <input type="hidden" name="option2Name" value="" />
              <input type="hidden" name="variantsJson" value="[]" />
            </>
          )}

          <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="primary" type="submit">
              Guardar
            </button>
          </div>
        </form>
      ) : (
        <div className="field-hint">Crea productos (con variantes opcionales) o servicios (sin variantes).</div>
      )}
    </div>
  );
}
