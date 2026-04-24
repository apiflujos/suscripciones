"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, normalizeSupportedCurrency } from "../lib/currencies";

function formatCurrencyInput(input: string, currency: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function NewProductForm({
  action,
  csrfToken,
  tenantId,
  tenants,
  returnTo
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  tenantId?: string;
  tenants: Array<{ id: string; name: string }>;
  returnTo?: string;
}) {
  const [kind, setKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [priceCop, setPriceCop] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [taxPercent, setTaxPercent] = useState("0");
  const [requiresShipping, setRequiresShipping] = useState(false);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(tenantId ? [tenantId] : []);

  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
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
      .catch((err) => {
        setImageError(String(err?.message || "No se pudo subir la imagen."));
      })
      .finally(() => {
        setImageUploading(false);
      });
  }

  return (
    <form action={action} className="panel module compact-form" style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="csrf" value={csrfToken} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <input type="hidden" name="imageUrl" value={imageUrl} />
      {selectedTenantIds.map((id) => (
        <input key={id} type="hidden" name="tenantIds" value={id} />
      ))}

      <div className="panelHeaderRow">
        <strong>Crear producto / servicio</strong>
        <div className="field-hint">Define el producto base del catálogo. Luego lo puedes usar para crear suscripciones.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="field">
          <label>Tipo</label>
          <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="PRODUCT">Producto</option>
            <option value="SERVICE">Servicio</option>
          </select>
        </div>
        <div className="field">
          <label>Nombre</label>
          <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
      </div>
      {tenants.length > 0 ? (
        <div className="field">
          <label>Canal(es)</label>
          <div className="tenant-list">
            {tenants.map((t) => {
              const checked = selectedTenantIds.includes(t.id);
              return (
                <label key={t.id} className="tenant-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? Array.from(new Set([...selectedTenantIds, t.id]))
                        : selectedTenantIds.filter((id) => id !== t.id);
                      setSelectedTenantIds(next);
                    }}
                  />
                  <span>{t.name}</span>
                </label>
              );
            })}
          </div>
          <div className="field-hint">
            {selectedTenantIds.length ? `${selectedTenantIds.length} canal(es) seleccionado(s).` : "Selecciona uno o varios canales."}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div className="field">
          <label>Moneda</label>
          <select
            className="select"
            name="currency"
            value={currency}
            onChange={(e) => {
              const next = normalizeSupportedCurrency(e.target.value);
              setCurrency(next);
              setPriceCop(formatCurrencyInput(priceCop, next));
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
          <label>SKU</label>
          <input className="input" name="sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
        </div>
        <div className="field">
          <label>Precio base</label>
          <input
            className="input no-icon"
            name="basePricePesos"
            inputMode="numeric"
            value={priceCop}
            onChange={(e) => setPriceCop(formatCurrencyInput(e.target.value, currency))}
            required
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div className="field">
          <label>Impuesto</label>
          <select className="select" name="taxPercent" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)}>
            <option value="0">Sin impuesto</option>
            <option value="19">IVA 19%</option>
            <option value="8">Consumo 8%</option>
          </select>
        </div>
        <div className="field">
          <label>Envío</label>
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
        <div className="field">
          <label>Subir archivo (opcional)</label>
          <div className="file-row">
            <input type="file" accept="image/*" onChange={onImageFile} />
            {imageUrl ? <img src={imageUrl} alt="Producto" className="logo-preview" /> : null}
            {imageUrl ? (
              <button type="button" className="ghost" onClick={() => { setImageUrl(""); }}>
                Quitar
              </button>
            ) : null}
          </div>
          {imageUploading ? <div className="field-hint">Subiendo imagen…</div> : null}
          {imageError ? <div className="field-hint" style={{ color: "var(--status-warning)" }}>{imageError}</div> : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
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

      <div className="field">
        <label>Descripción</label>
        <textarea className="input" name="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="module-footer">
        <PendingButton className="primary btn-compact btn-create" type="submit" pendingText="Guardando...">
          Crear producto/servicio
        </PendingButton>
      </div>
    </form>
  );
}
