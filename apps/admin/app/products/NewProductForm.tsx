"use client";

import { useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";

function formatCopCurrency(input: string): string {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const value = Number(digits);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
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
  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");
  const [taxPercent, setTaxPercent] = useState("0");
  const [requiresShipping, setRequiresShipping] = useState(false);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(tenantId ? [tenantId] : []);
  const [collectionMode, setCollectionMode] = useState<"AUTO_LINK" | "AUTO_DEBIT">("AUTO_LINK");

  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  return (
    <form action={action} className="panel module" style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="csrf" value={csrfToken} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <input type="hidden" name="currency" value="COP" />
      <input type="hidden" name="imageUrl" value={imageUrl} />
      {selectedTenantIds.map((id) => (
        <input key={id} type="hidden" name="tenantIds" value={id} />
      ))}

      <div className="panelHeaderRow">
        <strong>Crear producto / servicio</strong>
        <div className="field-hint">Define el ítem recurrente. Luego lo puedes usar en planes y suscripciones.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div className="field">
          <label>Tipo</label>
          <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="PRODUCT">Producto</option>
            <option value="SERVICE">Servicio</option>
          </select>
        </div>
        <div className="field">
          <label>Tipo de cobro</label>
          <select className="select" name="collectionMode" value={collectionMode} onChange={(e) => setCollectionMode(e.target.value as any)}>
            <option value="AUTO_LINK">Plan (link de pago)</option>
            <option value="AUTO_DEBIT">Suscripción (tokenización)</option>
          </select>
          <div className="field-hint">Define si este producto se cobra por link o por tokenización.</div>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>SKU</span>
            <HelpTip text="Código único para identificar el ítem." />
          </label>
          <input className="input" name="sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Precio base</span>
            <HelpTip text="Antes de impuestos/descuentos." />
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
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Recurrencia</span>
            <HelpTip text="Cada cuánto se cobra este producto/servicio." />
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
            <HelpTip text="Cantidad de unidades por ciclo." />
          </label>
          <input className="input" name="intervalCount" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} inputMode="numeric" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
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
          <label>Imagen (URL)</label>
          <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
          <div className="field-hint">Opcional. Pega una URL pública de imagen.</div>
        </div>
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

      <div className="field">
        <label>Descripción</label>
        <textarea className="input" name="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
        <PendingButton className="primary" type="submit" pendingText="Guardando...">
          Crear producto/servicio
        </PendingButton>
      </div>
    </form>
  );
}
