"use client";

import { useMemo, useState } from "react";
import { VariantsEditor } from "./VariantsEditor";

function pesosToCents(pesosRaw: string): number {
  const digits = String(pesosRaw || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
}

export function NewCatalogItemForm({
  action
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [show, setShow] = useState(false);
  const [option1Name, setOption1Name] = useState("Talla");
  const [option2Name, setOption2Name] = useState("Color");
  const [basePricePesos, setBasePricePesos] = useState("");

  const preview = useMemo(() => {
    const cents = pesosToCents(basePricePesos);
    const pesos = Math.trunc(cents / 100);
    if (!Number.isFinite(pesos)) return "—";
    return `$${pesos.toLocaleString("es-CO")}`;
  }, [basePricePesos]);

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

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Nombre</label>
              <input className="input" name="name" placeholder={kind === "SERVICE" ? "Ej: Membresía VIP" : "Ej: Zapato Olivia"} required />
            </div>
            <div className="field">
              <label>SKU / Referencia</label>
              <input className="input" name="sku" placeholder="OLIVIA-001" required />
            </div>
          </div>

          <div className="field">
            <label>Descripción</label>
            <textarea className="input" name="description" rows={3} placeholder="(Base Shopify/Alegra)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Vendor (Shopify)</label>
              <input className="input" name="vendor" placeholder="Marca / proveedor" />
            </div>
            <div className="field">
              <label>Product type (Shopify)</label>
              <input className="input" name="productType" placeholder="Categoría" />
            </div>
            <div className="field">
              <label>Tags (Shopify)</label>
              <input className="input" name="tags" placeholder="tag1, tag2" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>Moneda</label>
              <input className="input" name="currency" defaultValue="COP" />
            </div>
            <div className="field">
              <label>Precio base ($)</label>
              <input
                className="input"
                name="basePricePesos"
                inputMode="numeric"
                value={basePricePesos}
                onChange={(e) => setBasePricePesos(e.target.value)}
                placeholder="150500"
                required
              />
              <div className="field-hint">Vista: {preview}</div>
            </div>
            <div className="field">
              <label>Unidad (Alegra)</label>
              <input className="input" name="unit" placeholder="UND" />
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
              <label>Descuento fijo ($)</label>
              <input className="input" name="discountValuePesos" placeholder="0" inputMode="numeric" />
            </div>
            <div className="field">
              <label>Descuento %</label>
              <input className="input" name="discountPercent" placeholder="0" inputMode="numeric" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
              <input name="taxable" type="checkbox" defaultChecked />
              <span>Taxable (Shopify)</span>
            </label>
            <label className="field" style={{ gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
              <input name="requiresShipping" type="checkbox" defaultChecked={kind === "PRODUCT"} />
              <span>Requires shipping (Shopify)</span>
            </label>
          </div>

          {kind === "PRODUCT" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Opción 1 (ej: Talla)</label>
                  <input className="input" name="option1Name" value={option1Name} onChange={(e) => setOption1Name(e.target.value)} />
                </div>
                <div className="field">
                  <label>Opción 2 (ej: Color)</label>
                  <input className="input" name="option2Name" value={option2Name} onChange={(e) => setOption2Name(e.target.value)} />
                </div>
              </div>
              <VariantsEditor option1Name={option1Name} option2Name={option2Name} />
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
        <div className="field-hint">Crea productos (con variantes) o servicios (sin variantes).</div>
      )}
    </div>
  );
}

