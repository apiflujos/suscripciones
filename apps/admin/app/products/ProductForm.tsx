"use client";

import { useState } from "react";
import { FormActions, PageSection } from "../ui/PageShell";
import { PendingButton } from "../ui/PendingButton";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, normalizeSupportedCurrency } from "../lib/currencies";
import { VariantsEditor } from "./VariantsEditor";
import { formatCurrencyInput, formatMoneyFromCents } from "./format";
import "./products.css";

export type ProductFormValues = {
  id: string;
  kind: "PRODUCT" | "SERVICE";
  name: string;
  sku: string;
  description?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string | null;
  unit?: string | null;
  currency: string;
  basePriceInCents: number;
  taxPercent?: number;
  discountType?: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents?: number;
  discountPercent?: number;
  requiresShipping?: boolean;
  option1Name?: string | null;
  option2Name?: string | null;
  variants?: Array<{ option1?: string | null; option2?: string | null; priceDeltaInCents: number }> | null;
  imageUrl?: string | null;
  tenantId?: string | null;
  tenantIds?: string[];
};

/**
 * Formulario de producto/servicio, el mismo para crear (`/products/new`) y para
 * editar (`/products/[id]`). Antes eran dos formularios casi iguales dentro de
 * modales; ahora es una sola página con las mismas validaciones del servidor.
 */
export function ProductForm({
  action,
  csrfToken,
  tenants,
  returnTo,
  failTo,
  product,
  defaultTenantId
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  tenants: Array<{ id: string; name: string }>;
  returnTo: string;
  /** Página del formulario: si el servidor rechaza el envío, vuelve aquí y no se pierde lo escrito. */
  failTo: string;
  product?: ProductFormValues | null;
  defaultTenantId?: string;
}) {
  const editing = Boolean(product);
  const initialCurrency = normalizeSupportedCurrency(product?.currency || DEFAULT_CURRENCY);
  const initialTenantIds = product
    ? Array.isArray(product.tenantIds) && product.tenantIds.length
      ? product.tenantIds
      : product.tenantId
        ? [product.tenantId]
        : []
    : defaultTenantId
      ? [defaultTenantId]
      : [];
  const hasOpt2 = Boolean(product?.option2Name) || (product?.variants || []).some((v) => v?.option2);
  const hasOpt1 = Boolean(product?.option1Name) || (product?.variants || []).some((v) => v?.option1);

  const [kind, setKind] = useState<"PRODUCT" | "SERVICE">(product?.kind || "PRODUCT");
  const [name, setName] = useState(product?.name || "");
  const [sku, setSku] = useState(product?.sku || "");
  const [description, setDescription] = useState(product?.description || "");
  const [vendor, setVendor] = useState(product?.vendor || "");
  const [productType, setProductType] = useState(product?.productType || "");
  const [tags, setTags] = useState(product?.tags || "");
  const [unit, setUnit] = useState(product?.unit || "");
  const [currency, setCurrency] = useState<string>(initialCurrency);
  const [priceCop, setPriceCop] = useState(product ? formatMoneyFromCents(product.basePriceInCents, initialCurrency) : "");
  const [taxPercent, setTaxPercent] = useState(String(product?.taxPercent ?? 0));
  const [discountType, setDiscountType] = useState<"NONE" | "FIXED" | "PERCENT">(product?.discountType || "NONE");
  const [discountCop, setDiscountCop] = useState(
    product && product.discountValueInCents ? formatMoneyFromCents(product.discountValueInCents, initialCurrency) : ""
  );
  const [discountPercent, setDiscountPercent] = useState(String(product?.discountPercent ?? 0));
  const [requiresShipping, setRequiresShipping] = useState(Boolean(product?.requiresShipping));
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(initialTenantIds);
  const [primaryTenantId, setPrimaryTenantId] = useState(String(product?.tenantId || initialTenantIds[0] || ""));
  const [option1Name, setOption1Name] = useState(product?.option1Name || "");
  const [option2Name, setOption2Name] = useState(product?.option2Name || "");
  const [variantOptionsCount, setVariantOptionsCount] = useState<0 | 1 | 2>(hasOpt2 ? 2 : hasOpt1 ? 1 : 0);
  // Valor inicial fijo: si cambiara con cada edición, el editor reiniciaría sus filas.
  const [initialVariantsJson] = useState(JSON.stringify(product?.variants || []));
  const [imageUrl, setImageUrl] = useState(String(product?.imageUrl || ""));
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");

  const showVariants = variantOptionsCount > 0 && kind === "PRODUCT";
  const showOption2 = showVariants && variantOptionsCount === 2;

  function toggleTenant(id: string, checked: boolean) {
    const next = checked ? Array.from(new Set([...selectedTenantIds, id])) : selectedTenantIds.filter((v) => v !== id);
    setSelectedTenantIds(next);
    if (!next.length) setPrimaryTenantId("");
    else if (!next.includes(primaryTenantId)) setPrimaryTenantId(next[0] || "");
  }

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setImageError("La imagen supera 2MB. Usa una URL pública o comprímela.");
      return;
    }
    setImageUploading(true);
    setImageError("");
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/uploads/product-image", { method: "POST", body: fd })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "upload_failed");
        const url = String(json?.url || "").trim();
        if (!url) throw new Error("upload_missing_url");
        setImageUrl(url);
      })
      .catch((err) => setImageError(String(err?.message || "No se pudo subir la imagen.")))
      .finally(() => setImageUploading(false));
  }

  return (
    <form action={action} className="page-shell-body product-form">
      <input type="hidden" name="csrf" value={csrfToken} />
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="failTo" value={failTo} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="imageUrl" value={imageUrl} />
      {product ? <input type="hidden" name="tenantId" value={product.tenantId || ""} /> : null}
      {editing ? <input type="hidden" name="primaryTenantId" value={primaryTenantId} /> : null}
      {selectedTenantIds.map((id) => (
        <input key={id} type="hidden" name="tenantIds" value={id} />
      ))}
      <input type="hidden" name="taxable" value="on" />

      <PageSection title="Datos básicos" description="Define qué es y cómo se identifica en el catálogo.">
        <div className="page-shell-form-grid">
          <div className="field">
            <label htmlFor="pf-kind">Tipo</label>
            <select id="pf-kind" className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as "PRODUCT" | "SERVICE")}>
              <option value="PRODUCT">Producto</option>
              <option value="SERVICE">Servicio</option>
            </select>
            <div className="field-hint">Producto permite variantes y envío. Servicio no requiere envío.</div>
          </div>
          <div className="field">
            <label htmlFor="pf-sku">Referencia / SKU</label>
            <input id="pf-sku" className="input" name="sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
            <div className="field-hint">Código único para identificar el ítem.</div>
          </div>
          <div className="field field-full">
            <label htmlFor="pf-name">Nombre</label>
            <input id="pf-name" className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field field-full">
            <label htmlFor="pf-description">Descripción</label>
            <textarea id="pf-description" className="input" name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-vendor">Marca / Proveedor</label>
            <input id="pf-vendor" className="input" name="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-type">Categoría</label>
            <input id="pf-type" className="input" name="productType" value={productType} onChange={(e) => setProductType(e.target.value)} />
          </div>
          <div className="field field-full">
            <label htmlFor="pf-tags">Etiquetas</label>
            <input id="pf-tags" className="input" name="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
        </div>
      </PageSection>

      {tenants.length > 0 ? (
        <PageSection title="Canales" description="Puedes seleccionar uno o varios canales.">
          <fieldset className="product-fieldset">
            <legend className="product-legend">Canal(es)</legend>
            <div className="product-check-list">
              {tenants.map((t) => {
                const id = String(t.id || "");
                return (
                  <label key={id} className="product-check">
                    <input type="checkbox" checked={selectedTenantIds.includes(id)} onChange={(e) => toggleTenant(id, e.target.checked)} />
                    <span>{t.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="field-hint">
            {selectedTenantIds.length ? `${selectedTenantIds.length} canal(es) seleccionado(s).` : "Selecciona uno o varios canales."}
          </div>
          {editing ? (
            <div className="field">
              <label htmlFor="pf-primary-tenant">Canal principal</label>
              <select
                id="pf-primary-tenant"
                className="select"
                value={primaryTenantId}
                onChange={(e) => setPrimaryTenantId(String(e.target.value || ""))}
                disabled={!selectedTenantIds.length}
              >
                <option value="">Sin canal principal</option>
                {selectedTenantIds.map((id) => (
                  <option key={`primary-${id}`} value={id}>
                    {tenants.find((t) => String(t.id) === id)?.name || id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </PageSection>
      ) : null}

      <PageSection title="Imagen" description="Opcional. Para enviarla por WhatsApp debe ser una URL pública https.">
        <div className="field">
          <label htmlFor="pf-image">Subir archivo (opcional)</label>
          <input id="pf-image" type="file" accept="image/*" onChange={onImageFile} />
        </div>
        {imageUrl ? (
          <div className="product-image-row">
            <img src={imageUrl} alt="Imagen del producto" className="logo-preview" />
            <button type="button" className="ghost btn-compact" onClick={() => setImageUrl("")}>
              Quitar imagen
            </button>
          </div>
        ) : null}
        {imageUploading ? <div className="field-hint" role="status">Subiendo imagen…</div> : null}
        {imageError ? <div className="field-hint ui-alert-danger" role="alert">{imageError}</div> : null}
      </PageSection>

      <PageSection title="Precio e impuestos">
        <div className="page-shell-form-grid">
          <div className="field">
            <label htmlFor="pf-currency">Moneda</label>
            <select
              id="pf-currency"
              className="select"
              name="currencySelect"
              value={currency}
              onChange={(e) => {
                const next = normalizeSupportedCurrency(e.target.value);
                setCurrency(next);
                setPriceCop(formatCurrencyInput(priceCop, next));
                setDiscountCop(formatCurrencyInput(discountCop, next));
              }}
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-price">Precio base</label>
            <input
              id="pf-price"
              className="input no-icon"
              name="basePricePesos"
              inputMode="numeric"
              value={priceCop}
              onChange={(e) => setPriceCop(formatCurrencyInput(e.target.value, currency))}
              required
            />
            <div className="field-hint">Precio base antes de impuestos y descuentos.</div>
          </div>
          <div className="field">
            <label htmlFor="pf-unit">Unidad</label>
            <input id="pf-unit" className="input" name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            <div className="field-hint">Unidad de medida interna. Ej: UND, MES, HORA.</div>
          </div>
          <div className="field">
            <label htmlFor="pf-shipping">{kind === "PRODUCT" ? "Requiere envío" : "Requiere envío (no aplica a servicios)"}</label>
            <select
              id="pf-shipping"
              className="select"
              name="requiresShipping"
              value={requiresShipping ? "on" : ""}
              onChange={(e) => setRequiresShipping(e.target.value === "on")}
              disabled={kind === "SERVICE"}
            >
              <option value="">No</option>
              <option value="on">Sí</option>
            </select>
            <div className="field-hint">Actívalo solo si el producto necesita logística de envío.</div>
          </div>
          <div className="field">
            <label htmlFor="pf-tax">Impuesto</label>
            <select id="pf-tax" className="select" name="taxPercent" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)}>
              <option value="0">Sin impuesto</option>
              <option value="19">IVA 19%</option>
              <option value="8">Consumo 8%</option>
            </select>
            <div className="field-hint">Se aplica sobre el precio base.</div>
          </div>
          <div className="field">
            <label htmlFor="pf-discount-type">Descuento</label>
            <select
              id="pf-discount-type"
              className="select"
              name="discountType"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "NONE" | "FIXED" | "PERCENT")}
            >
              <option value="NONE">Sin descuento</option>
              <option value="FIXED">Valor fijo</option>
              <option value="PERCENT">Porcentaje</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-discount-value">Descuento (valor)</label>
            <input
              id="pf-discount-value"
              className="input"
              name="discountValuePesos"
              placeholder="$ 0"
              inputMode="numeric"
              value={discountCop}
              onChange={(e) => setDiscountCop(formatCurrencyInput(e.target.value, currency))}
            />
            <div className="field-hint">Valor fijo en {currency}.</div>
          </div>
          <div className="field">
            <label htmlFor="pf-discount-percent">Descuento (%)</label>
            <input
              id="pf-discount-percent"
              className="input"
              name="discountPercent"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              inputMode="numeric"
            />
            <div className="field-hint">Porcentaje entre 0 y 100.</div>
          </div>
        </div>
      </PageSection>

      {kind === "PRODUCT" ? (
        <PageSection title="Variantes" description="Define opciones (ej: talla o color) y luego las combinaciones.">
          <div className="field">
            <label htmlFor="pf-variant-count">Opciones de variante</label>
            <select
              id="pf-variant-count"
              className="select"
              value={variantOptionsCount}
              onChange={(e) => setVariantOptionsCount(Number(e.target.value) as 0 | 1 | 2)}
            >
              <option value={0}>Sin variantes</option>
              <option value={1}>1 opción</option>
              <option value={2}>2 opciones</option>
            </select>
          </div>

          {showVariants ? (
            <div className="page-shell-form-grid">
              <div className="field">
                <label htmlFor="pf-opt1">{showOption2 ? "Opción 1" : "Nombre de opción"}</label>
                <input id="pf-opt1" className="input" name="option1Name" value={option1Name} onChange={(e) => setOption1Name(e.target.value)} />
              </div>
              {showOption2 ? (
                <div className="field">
                  <label htmlFor="pf-opt2">Opción 2</label>
                  <input id="pf-opt2" className="input" name="option2Name" value={option2Name} onChange={(e) => setOption2Name(e.target.value)} />
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
              initialJson={initialVariantsJson}
              resetKey={product?.id || "new"}
            />
          ) : (
            <input type="hidden" name="variantsJson" value="[]" />
          )}
        </PageSection>
      ) : (
        <>
          <input type="hidden" name="requiresShipping" value="" />
          <input type="hidden" name="option1Name" value="" />
          <input type="hidden" name="option2Name" value="" />
          <input type="hidden" name="variantsJson" value="[]" />
        </>
      )}

      <FormActions cancelHref={returnTo}>
        <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Guardando...">
          {editing ? "Guardar cambios" : "Crear producto/servicio"}
        </PendingButton>
      </FormActions>
    </form>
  );
}
