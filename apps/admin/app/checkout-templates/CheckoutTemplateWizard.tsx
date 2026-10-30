"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FormActions, PageSection } from "../ui/PageShell";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";
import { checkoutTemplateKindLabel, type TemplateKind, type TemplateProduct, type TemplateTenant } from "./templateErrors";

type Layout = {
  primaryColor?: string;
  fontFamily?: string;
  supportEmail?: string;
  supportUrl?: string;
  ctaLabel?: string;
  fields?: { showName?: boolean; showPhone?: boolean; showEmail?: boolean };
};

export type WizardTemplate = {
  id: string;
  name: string;
  kind: TemplateKind;
  active: boolean;
  tenantId?: string | null;
  allowProductSelect: boolean;
  productIds?: any;
  expiryHours?: number | null;
  logoUrl?: string | null;
  publicTitle?: string | null;
  publicDescription?: string | null;
  wompiTitle?: string | null;
  wompiDescription?: string | null;
  utmParams?: string | null;
  layout?: any;
};

type ProductSelection = { id: string; mode: "AUTO_LINK" | "AUTO_DEBIT" };

const STEPS = [
  { id: "type", label: "Tipo" },
  { id: "content", label: "Contenido" },
  { id: "brand", label: "Branding" },
  { id: "products", label: "Productos" },
  { id: "review", label: "Revisión" }
];

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function normalizeSelections(raw: any): ProductSelection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => {
      if (typeof entry === "string") return { id: entry, mode: "AUTO_LINK" as const };
      const id = String(entry?.id || "").trim();
      if (!id) return null;
      const mode = String(entry?.mode || "AUTO_LINK").toUpperCase() === "AUTO_DEBIT" ? "AUTO_DEBIT" : "AUTO_LINK";
      return { id, mode };
    })
    .filter(Boolean) as ProductSelection[];
}

/**
 * Asistente de plantilla de checkout (tipo, contenido, branding, productos, revisión).
 * Es el mismo asistente que vivía en un modal de 900 px; ahora ocupa su propia página
 * y la barra inferior trae Cancelar (enlace), Atrás, Siguiente y Guardar.
 */
export function CheckoutTemplateWizard({
  template,
  products,
  tenants,
  csrfToken,
  returnTo,
  errorTo,
  action,
  initialKind = ""
}: {
  template: WizardTemplate | null;
  products: TemplateProduct[];
  tenants: TemplateTenant[];
  csrfToken: string;
  returnTo: string;
  errorTo: string;
  action: (formData: FormData) => void;
  initialKind?: TemplateKind | "";
}) {
  const editing = template;
  const layout = (editing?.layout || {}) as Layout;
  const [stepIndex, setStepIndex] = useState<number>(editing || initialKind ? 1 : 0);
  const [kind, setKind] = useState<TemplateKind | "">(editing ? editing.kind : initialKind);
  const [name, setName] = useState(editing?.name || "");
  const [active, setActive] = useState(editing ? Boolean(editing.active) : true);
  const [allowSelect, setAllowSelect] = useState(editing ? Boolean(editing.allowProductSelect) : true);
  const [productIds, setProductIds] = useState<ProductSelection[]>(() => normalizeSelections(editing?.productIds));
  const [tenantId, setTenantId] = useState(String(editing?.tenantId || ""));
  const [productQuery, setProductQuery] = useState("");
  const [expiryHours, setExpiryHours] = useState(editing ? (editing.expiryHours ? String(editing.expiryHours) : "24") : "24");
  const [logoUrl, setLogoUrl] = useState(editing?.logoUrl || "");
  const [publicTitle] = useState(editing?.publicTitle || "");
  const [publicDescription] = useState(editing?.publicDescription || "");
  const [wompiTitle, setWompiTitle] = useState(editing ? editing.wompiTitle || editing.publicTitle || "" : "");
  const [wompiDescription, setWompiDescription] = useState(editing ? editing.wompiDescription || editing.publicDescription || "" : "");
  const [utmParams] = useState(editing?.utmParams || "");
  const [primaryColor, setPrimaryColor] = useState(layout.primaryColor || "");
  const [fontFamily, setFontFamily] = useState(layout.fontFamily || "");
  const [supportEmail, setSupportEmail] = useState(layout.supportEmail || "");
  const [supportUrl, setSupportUrl] = useState(layout.supportUrl || "");
  const [ctaLabel, setCtaLabel] = useState(layout.ctaLabel || "");
  const [showName, setShowName] = useState(layout.fields?.showName !== false);
  const [showPhone, setShowPhone] = useState(layout.fields?.showPhone !== false);
  const [showEmail, setShowEmail] = useState(Boolean(layout.fields?.showEmail));
  const [localError, setLocalError] = useState("");

  const nameRef = useRef<HTMLInputElement | null>(null);
  const tenantRef = useRef<HTMLSelectElement | null>(null);
  const productsRef = useRef<HTMLDivElement | null>(null);
  const typeRef = useRef<HTMLInputElement | null>(null);

  const productById = useMemo(() => {
    const map = new Map<string, TemplateProduct>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const selectedKind = kind;
  const isCart = selectedKind === "CART";
  const isProductsValid = productIds.length > 0;
  const missingKind = !selectedKind;
  const missingName = !name.trim();
  const requireTenant = Array.isArray(tenants) && tenants.length > 0;
  const missingTenant = requireTenant && !tenantId;
  const missingProducts = !isProductsValid;
  const isLast = stepIndex === STEPS.length - 1;

  const layoutPayload: Layout = {
    primaryColor: primaryColor || undefined,
    fontFamily: fontFamily || undefined,
    supportEmail: supportEmail || undefined,
    supportUrl: supportUrl || undefined,
    ctaLabel: ctaLabel || undefined,
    fields: { showName, showPhone, showEmail }
  };

  const filteredProducts = useMemo(() => {
    const needle = productQuery.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((product) => {
      const sku = String(product.sku || product.metadata?.sku || "").trim();
      return [product.name, sku, product.id].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [productQuery, products]);

  useEffect(() => {
    if (requireTenant && tenants.length === 1 && !tenantId) setTenantId(tenants[0].id);
  }, [requireTenant, tenants, tenantId]);

  useEffect(() => {
    if (selectedKind !== "CART" && allowSelect) setAllowSelect(false);
  }, [selectedKind, allowSelect]);

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) setLogoUrl(result);
    };
    reader.readAsDataURL(file);
  }

  function validateAndFocus() {
    if (!selectedKind) {
      setStepIndex(0);
      setLocalError("Selecciona el tipo de plantilla.");
      setTimeout(() => typeRef.current?.focus(), 0);
      return false;
    }
    if (!name.trim()) {
      setStepIndex(1);
      setLocalError("Debes ingresar el nombre interno.");
      setTimeout(() => nameRef.current?.focus(), 0);
      return false;
    }
    if (missingTenant) {
      setStepIndex(1);
      setLocalError("Selecciona el canal de ventas.");
      setTimeout(() => tenantRef.current?.focus(), 0);
      return false;
    }
    if (!isProductsValid) {
      setStepIndex(3);
      setLocalError("Debes seleccionar un producto.");
      setTimeout(() => productsRef.current?.focus(), 0);
      return false;
    }
    setLocalError("");
    return true;
  }

  /** Mensaje del primer requisito que falta para salir del paso `idx` (o de llegar al `idx`). */
  function blockerFor(idx: number): string {
    if (idx > 0 && !selectedKind) return "Selecciona el tipo de plantilla.";
    if (idx > 1 && !name.trim()) return "Debes ingresar el nombre interno.";
    if (idx > 1 && missingTenant) return "Selecciona el canal de ventas.";
    if (idx > 3 && !isProductsValid) return "Debes seleccionar un producto.";
    return "";
  }

  function goTo(idx: number) {
    const blocker = blockerFor(idx);
    if (blocker) {
      setLocalError(blocker);
      return;
    }
    setLocalError("");
    setStepIndex(idx);
  }

  function next() {
    goTo(Math.min(STEPS.length - 1, stepIndex + 1));
  }

  const nextDisabled =
    (stepIndex === 0 && !kind) ||
    (stepIndex === 1 && (!name.trim() || missingTenant)) ||
    (stepIndex === 3 && !isProductsValid);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Enter en un campo avanza de paso; solo el último paso guarda.
        if (!isLast) {
          e.preventDefault();
          if (!nextDisabled) next();
          return;
        }
        if (!validateAndFocus()) e.preventDefault();
      }}
      className="page-shell-body"
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="errorTo" value={errorTo} />
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      <input type="hidden" name="kind" value={selectedKind} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="active" value={active ? "on" : ""} />
      <input type="hidden" name="expiryHours" value={expiryHours} />
      <input type="hidden" name="allowProductSelect" value={isCart && allowSelect ? "on" : ""} />
      <input type="hidden" name="logoUrl" value={logoUrl} />
      <input type="hidden" name="productIds" value={JSON.stringify(productIds)} />
      <input type="hidden" name="layout" value={JSON.stringify(layoutPayload)} />
      <input type="hidden" name="publicTitle" value={wompiTitle || publicTitle} />
      <input type="hidden" name="publicDescription" value={wompiDescription || publicDescription} />
      <input type="hidden" name="wompiTitle" value={wompiTitle || publicTitle} />
      <input type="hidden" name="wompiDescription" value={wompiDescription || publicDescription} />
      <input type="hidden" name="utmParams" value={utmParams} />

      <nav className="ct-steps" aria-label="Pasos de la plantilla">
        {STEPS.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            className={idx === stepIndex ? "primary" : "ghost"}
            aria-current={idx === stepIndex ? "step" : undefined}
            onClick={() => goTo(idx)}
            disabled={Boolean(blockerFor(idx))}
            data-loader="off"
          >
            {idx + 1}. {s.label}
          </button>
        ))}
      </nav>

      {localError ? (
        <div className="page-shell-notice is-error" role="alert">
          {localError}
        </div>
      ) : null}

      {stepIndex === 0 ? (
        <PageSection
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Tipo de plantilla
              <HelpTip text="Link de pago = cobro único. Suscripción = débito automático. Catálogo = selección de productos." />
            </span>
          }
          description={editing ? "El tipo no se puede cambiar al editar una plantilla." : undefined}
        >
          <div className="ct-kinds" role="radiogroup" aria-label="Tipo de plantilla">
            {(
              [
                ["PLAN", "Link de pago", "Cobro único con link directo."],
                ["SUBSCRIPTION", "Suscripción", "Cobro recurrente con débito automático."],
                ["CART", "Catálogo", "Selecciona productos desde el checkout."]
              ] as Array<[TemplateKind, string, string]>
            ).map(([value, title, hint], i) => (
              <label
                key={value}
                className={`card cardPad ct-kind ${kind === value ? "is-active" : ""}`}
                style={{
                  borderColor: kind === value ? "var(--primary)" : missingKind ? "var(--danger)" : "var(--stroke)",
                  background: kind === value ? "rgba(14, 165, 233, 0.08)" : "transparent",
                  boxShadow: kind === value ? "0 0 0 2px rgba(14, 165, 233, 0.25)" : "none",
                  cursor: editing ? "default" : "pointer"
                }}
              >
                <input
                  type="radio"
                  name="templateKind"
                  value={value}
                  checked={kind === value}
                  disabled={Boolean(editing)}
                  onChange={() => setKind(value)}
                  ref={i === 0 ? typeRef : undefined}
                />
                <strong>{title}</strong>
                <span className="field-hint">{hint}</span>
              </label>
            ))}
          </div>
        </PageSection>
      ) : null}

      {stepIndex === 1 ? (
        <PageSection title="Contenido">
          <div className="field">
            <label htmlFor="ct-name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Nombre interno
              <HelpTip text="Solo visible en el panel. Útil para identificar la plantilla." />
            </label>
            <input
              id="ct-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              aria-invalid={missingName}
              style={missingName ? { borderColor: "var(--danger)" } : undefined}
              ref={nameRef}
            />
          </div>
          {requireTenant ? (
            <div className="field">
              <label htmlFor="ct-tenant" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Canal de ventas
                <HelpTip text="Define el tenant/canal que usará esta plantilla." />
              </label>
              <select
                id="ct-tenant"
                className="select"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                aria-invalid={missingTenant}
                style={missingTenant ? { borderColor: "var(--danger)" } : undefined}
                ref={tenantRef}
              >
                <option value="">Selecciona un canal</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {missingTenant ? <div className="field-hint ct-error">Selecciona el canal de ventas.</div> : null}
            </div>
          ) : null}
          <label className="field row" htmlFor="ct-active">
            <span>Activa</span>
            <input id="ct-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </label>
          <div className="page-shell-section" style={{ boxShadow: "none" }}>
            <div className="page-shell-section-head">
              <h3 className="page-shell-section-title">Mensajes Wompi</h3>
            </div>
            <div className="page-shell-section-body">
              <div className="field">
                <label htmlFor="ct-wompi-title">{selectedKind === "SUBSCRIPTION" ? "Título suscripción" : "Título plan"}</label>
                <input id="ct-wompi-title" className="input" value={wompiTitle} onChange={(e) => setWompiTitle(e.target.value)} placeholder="Título" />
              </div>
              <div className="field">
                <label htmlFor="ct-wompi-desc">{selectedKind === "SUBSCRIPTION" ? "Descripción suscripción" : "Descripción plan"}</label>
                <textarea
                  id="ct-wompi-desc"
                  className="input"
                  rows={2}
                  value={wompiDescription}
                  onChange={(e) => setWompiDescription(e.target.value)}
                  onInput={(e) => autoResizeTextarea(e.currentTarget)}
                  placeholder="Descripción corta"
                />
              </div>
            </div>
          </div>
        </PageSection>
      ) : null}

      {stepIndex === 2 ? (
        <PageSection title="Branding">
          <div className="field">
            <label htmlFor="ct-logo" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Logo
              <HelpTip text="Se muestra en el checkout público." />
            </label>
            <div className="file-row">
              <input id="ct-logo" type="file" accept="image/*" onChange={onLogoFile} />
              {logoUrl ? <img src={logoUrl} alt="Logo" className="logo-preview" /> : null}
            </div>
          </div>
          <div className="field">
            <label htmlFor="ct-color" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Color principal
              <HelpTip text="Color de botones y acentos del checkout." />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" aria-label="Elegir color principal" value={primaryColor || "#1f2937"} onChange={(e) => setPrimaryColor(e.target.value)} />
              <input id="ct-color" className="input" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#0ea5e9" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ct-font" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Tipografía (opcional)
              <HelpTip text="Si la dejas vacía se usa la fuente por defecto." />
            </label>
            <input id="ct-font" className="input" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="'Source Sans 3', sans-serif" />
          </div>
          <div className="field">
            <label htmlFor="ct-support-email" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Soporte (email)
              <HelpTip text="Email visible para asistencia del cliente." />
            </label>
            <input id="ct-support-email" className="input" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="soporte@tu-dominio.com" />
          </div>
          <div className="field">
            <label htmlFor="ct-support-url" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Soporte (URL)
              <HelpTip text="URL de soporte (ej: WhatsApp o landing)." />
            </label>
            <input id="ct-support-url" className="input" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://wa.me/57..." />
          </div>
          {selectedKind === "PLAN" ? (
            <div className="field">
              <label htmlFor="ct-cta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Texto del botón de pago
                <HelpTip text="Texto principal del CTA en el checkout." />
              </label>
              <input id="ct-cta" className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Pagar" />
            </div>
          ) : null}
        </PageSection>
      ) : null}

      {stepIndex === 3 ? (
        <PageSection title="Productos">
          <div className="field" ref={productsRef} tabIndex={-1}>
            <label htmlFor="ct-product-search" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {isCart ? "Productos disponibles" : "Producto asociado"}
              <HelpTip text={isCart ? "Selecciona los productos disponibles en el checkout público." : "Cada checkout público solo puede asociarse a un producto."} />
            </label>
            <input
              id="ct-product-search"
              className="input"
              type="search"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Buscar producto por nombre o SKU..."
              style={{ marginBottom: 8 }}
            />
            <div style={{ display: "grid", gap: 8 }}>
              {filteredProducts.map((p) => {
                const selection = productIds.find((item) => String(item.id) === String(p.id));
                const activeItem = Boolean(selection);
                const currentMode = selection?.mode || "AUTO_LINK";
                const productMode = String(p.collectionMode || "AUTO_LINK").toUpperCase() === "AUTO_DEBIT" ? "AUTO_DEBIT" : "AUTO_LINK";
                return (
                  <div
                    key={p.id}
                    className={`card cardPad ct-product ${isCart ? "is-cart" : ""} ${activeItem ? "is-active" : ""}`}
                    style={missingProducts ? { borderColor: "var(--danger)" } : undefined}
                  >
                    <label>
                      <input
                        type={isCart ? "checkbox" : "radio"}
                        name="templateProduct"
                        checked={activeItem}
                        onChange={() => {
                          const resolvedMode = isCart ? "AUTO_LINK" : productMode;
                          if (isCart) {
                            setProductIds((current) =>
                              activeItem ? current.filter((item) => String(item.id) !== String(p.id)) : [...current, { id: p.id, mode: resolvedMode }]
                            );
                          } else {
                            setProductIds([{ id: p.id, mode: resolvedMode }]);
                          }
                        }}
                      />
                      <span>{p.name}</span>
                    </label>
                    {isCart ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        <label className="field-hint" htmlFor={`ct-mode-${p.id}`} style={{ margin: 0 }}>
                          Tipo de cobro
                        </label>
                        <select
                          id={`ct-mode-${p.id}`}
                          className="select"
                          value={activeItem ? currentMode : ""}
                          disabled={!activeItem}
                          onChange={(e) => {
                            const nextMode = String(e.target.value || "AUTO_LINK").toUpperCase() === "AUTO_DEBIT" ? "AUTO_DEBIT" : "AUTO_LINK";
                            setProductIds((current) => current.map((item) => (String(item.id) === String(p.id) ? { ...item, mode: nextMode } : item)));
                          }}
                        >
                          <option value="AUTO_LINK">Link de pago</option>
                          <option value="AUTO_DEBIT">Débito automático</option>
                        </select>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {filteredProducts.length === 0 ? <div className="field-hint">No hay productos que coincidan con la búsqueda.</div> : null}
            {!isProductsValid ? <div className="field-hint ct-error">Debes seleccionar un producto.</div> : null}
          </div>
          <div className="field">
            <label htmlFor="ct-expiry" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Expiración
              <HelpTip text="Tiempo de validez del checkout público." />
            </label>
            <select id="ct-expiry" className="select" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)}>
              <option value="1">1 hora</option>
              <option value="6">6 horas</option>
              <option value="13">13 horas</option>
              <option value="24">24 horas</option>
              <option value="">Nunca</option>
            </select>
          </div>
          {selectedKind === "PLAN" ? (
            <fieldset style={{ display: "grid", gap: 8, border: 0, margin: 0, padding: 0 }}>
              <legend className="field-hint" style={{ display: "flex", alignItems: "center", gap: 6, padding: 0 }}>
                Campos visibles en el checkout
                <HelpTip text="Solo aplica para link de pago (plan)." />
              </legend>
              <label className="field row">
                <span>Mostrar nombre</span>
                <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
              </label>
              <label className="field row">
                <span>Mostrar teléfono</span>
                <input type="checkbox" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} />
              </label>
              <label className="field row">
                <span>Mostrar email</span>
                <input type="checkbox" checked={showEmail} onChange={(e) => setShowEmail(e.target.checked)} />
              </label>
            </fieldset>
          ) : null}
        </PageSection>
      ) : null}

      {stepIndex === 4 ? (
        <PageSection title="Revisión" description="Revisa la configuración antes de guardar.">
          {missingKind || missingName || missingTenant || missingProducts ? (
            <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
              Faltan datos obligatorios:
              <ul style={{ margin: "6px 0 0 16px" }}>
                {missingKind ? <li>Selecciona el tipo de plantilla.</li> : null}
                {missingName ? <li>Nombre interno.</li> : null}
                {missingTenant ? <li>Canal de ventas.</li> : null}
                {missingProducts ? <li>Selecciona un producto.</li> : null}
              </ul>
            </div>
          ) : null}
          <div className="card cardPad ct-review">
            <div><strong>Tipo:</strong> {selectedKind ? checkoutTemplateKindLabel(selectedKind) : "—"}</div>
            <div><strong>Nombre:</strong> {name || "—"}</div>
            <div><strong>Activa:</strong> {active ? "Sí" : "No"}</div>
            <div>
              <strong>Productos:</strong>{" "}
              {productIds.length
                ? productIds
                    .map((item) => `${productById.get(item.id)?.name || "—"}${isCart ? ` (${item.mode === "AUTO_DEBIT" ? "Débito automático" : "Link de pago"})` : ""}`)
                    .join(", ")
                : "—"}
            </div>
            <div><strong>Expiración:</strong> {expiryHours ? `${expiryHours}h` : "Nunca"}</div>
            <div><strong>Soporte:</strong> {supportEmail || supportUrl || "—"}</div>
            <div><strong>Color:</strong> {primaryColor || "—"}</div>
          </div>
        </PageSection>
      ) : null}

      <FormActions cancelHref={returnTo}>
        <button
          className="ghost btn-compact btn-back"
          type="button"
          data-loader="off"
          onClick={() => {
            setLocalError("");
            setStepIndex(Math.max(0, stepIndex - 1));
          }}
          disabled={stepIndex === 0}
        >
          Atrás
        </button>
        {!isLast ? (
          <button className="primary btn-compact btn-next" type="button" data-loader="off" onClick={next} disabled={nextDisabled}>
            Siguiente
          </button>
        ) : (
          <PendingButton
            className="primary btn-compact btn-save"
            type="submit"
            pendingText="Guardando..."
            disabled={!selectedKind || !name || missingTenant || !isProductsValid}
          >
            {editing ? "Guardar" : "Guardar plantilla"}
          </PendingButton>
        )}
      </FormActions>
    </form>
  );
}
