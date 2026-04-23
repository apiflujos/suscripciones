"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppModal } from "../ui/AppModal";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";

type LayoutFields = {
  showName?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
};

type Layout = {
  primaryColor?: string;
  fontFamily?: string;
  supportEmail?: string;
  supportUrl?: string;
  ctaLabel?: string;
  fields?: LayoutFields;
};

type Template = {
  id: string;
  name: string;
  kind: "PLAN" | "SUBSCRIPTION" | "CART";
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

type Product = { id: string; name: string; sku?: string; metadata?: any };
type Tenant = { id: string; name: string };
type ProductSelection = { id: string; mode: "AUTO_LINK" | "AUTO_DEBIT" };

type WizardStep = {
  id: string;
  label: string;
};

const STEPS: WizardStep[] = [
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

export function CheckoutTemplatesPanel({
  templates,
  products,
  tenants,
  csrfToken,
  inlineState,
  initialKind = "",
  initialStep = "choose",
  checkoutDefaults,
  actions
}: {
  templates: Template[];
  products: Product[];
  tenants: Tenant[];
  csrfToken: string;
  inlineState: { action: string; status: string; errorText: string };
  initialKind?: "PLAN" | "SUBSCRIPTION" | "";
  initialStep?: "choose" | "form";
  checkoutDefaults?: {
    defaultPlanTemplateId?: string;
    defaultSubscriptionTemplateId?: string;
    defaultCartTemplateId?: string;
  };
  actions: {
    create: (formData: FormData) => void;
    update: (formData: FormData) => void;
    remove: (formData: FormData) => void;
    duplicate: (formData: FormData) => void;
    defaults: (formData: FormData) => void;
    saveDefaults: (formData: FormData) => void;
  };
}) {
  const [stepIndex, setStepIndex] = useState<number>(initialStep === "form" ? 1 : 0);
  const [editing, setEditing] = useState<Template | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [kind, setKind] = useState<"PLAN" | "SUBSCRIPTION" | "CART" | "">(
    initialKind === "PLAN" ? "PLAN" : initialKind === "SUBSCRIPTION" ? "SUBSCRIPTION" : ""
  );

  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [allowSelect, setAllowSelect] = useState(true);
  const [productIds, setProductIds] = useState<ProductSelection[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [expiryHours, setExpiryHours] = useState("24");
  const [logoUrl, setLogoUrl] = useState("");
  const [publicTitle, setPublicTitle] = useState("");
  const [publicDescription, setPublicDescription] = useState("");
  const [wompiTitle, setWompiTitle] = useState("");
  const [wompiDescription, setWompiDescription] = useState("");
  const [utmParams, setUtmParams] = useState("");

  const [primaryColor, setPrimaryColor] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [showName, setShowName] = useState(true);
  const [showPhone, setShowPhone] = useState(true);
  const [showEmail, setShowEmail] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const tenantRef = useRef<HTMLSelectElement | null>(null);
  const productsRef = useRef<HTMLDivElement | null>(null);
  const typeRef = useRef<HTMLLabelElement | null>(null);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  function normalizeSelections(raw: any): ProductSelection[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry: any) => {
        if (typeof entry === "string") return { id: entry, mode: "AUTO_LINK" as const };
        const id = String(entry?.id || "").trim();
        if (!id) return null;
        const modeRaw = String(entry?.mode || "AUTO_LINK").toUpperCase();
        const mode = modeRaw === "AUTO_DEBIT" ? "AUTO_DEBIT" : "AUTO_LINK";
        return { id, mode };
      })
      .filter(Boolean) as ProductSelection[];
  }

  function resetWizard() {
    setEditing(null);
    setEditModalOpen(false);
    setCreateModalOpen(false);
    setKind("");
    setName("");
    setActive(true);
    setAllowSelect(true);
    setProductIds([]);
    setTenantId("");
    setProductQuery("");
    setExpiryHours("24");
    setLogoUrl("");
    setPublicTitle("");
    setPublicDescription("");
    setWompiTitle("");
    setWompiDescription("");
    setUtmParams("");
    setPrimaryColor("");
    setFontFamily("");
    setSupportEmail("");
    setSupportUrl("");
    setCtaLabel("");
    setShowName(true);
    setShowPhone(true);
    setShowEmail(false);
    setStepIndex(0);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setEditModalOpen(true);
    setKind(t.kind);
    setName(t.name || "");
    setActive(Boolean(t.active));
    setAllowSelect(Boolean(t.allowProductSelect));
    setProductIds(normalizeSelections(t.productIds));
    setTenantId(String(t.tenantId || ""));
    setProductQuery("");
    setExpiryHours(t.expiryHours ? String(t.expiryHours) : "24");
    setLogoUrl(t.logoUrl || "");
    setPublicTitle(t.publicTitle || "");
    setPublicDescription(t.publicDescription || "");
    setWompiTitle(t.wompiTitle || t.publicTitle || "");
    setWompiDescription(t.wompiDescription || t.publicDescription || "");
    setUtmParams(t.utmParams || "");
    const layout = t.layout || {};
    setPrimaryColor(layout.primaryColor || "");
    setFontFamily(layout.fontFamily || "");
    setSupportEmail(layout.supportEmail || "");
    setSupportUrl(layout.supportUrl || "");
    setCtaLabel(layout.ctaLabel || "");
    setShowName(layout.fields?.showName !== false);
    setShowPhone(layout.fields?.showPhone !== false);
    setShowEmail(Boolean(layout.fields?.showEmail));
    setStepIndex(1);
  }

  function openCreate() {
    resetWizard();
    setCreateModalOpen(true);
  }

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

  const layoutPayload: Layout = {
    primaryColor: primaryColor || undefined,
    fontFamily: fontFamily || undefined,
    supportEmail: supportEmail || undefined,
    supportUrl: supportUrl || undefined,
    ctaLabel: ctaLabel || undefined,
    fields: {
      showName,
      showPhone,
      showEmail
    }
  };

  const formAction = editing ? actions.update : actions.create;
  const selectedKind = (editing ? editing.kind : kind) || "";
  const isCart = selectedKind === "CART";
  const isProductsValid = productIds.length > 0;
  const missingKind = !selectedKind;
  const missingName = !name.trim();
  const requireTenant = Array.isArray(tenants) && tenants.length > 0;
  const missingTenant = requireTenant && !tenantId;
  const missingProducts = !isProductsValid;
  const [localError, setLocalError] = useState<string>("");

  const filteredProducts = useMemo(() => {
    const needle = productQuery.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((product) => {
      const sku = String(product.sku || product.metadata?.sku || "").trim();
      const haystack = [product.name, sku, product.id].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [productQuery, products]);

  useEffect(() => {
    if (requireTenant && tenants.length === 1 && !tenantId) {
      setTenantId(tenants[0].id);
    }
  }, [requireTenant, tenants, tenantId]);

  useEffect(() => {
    if (selectedKind !== "CART" && allowSelect) {
      setAllowSelect(false);
    }
  }, [selectedKind, allowSelect]);

  const inlineMsg = (key: string) => {
    if (inlineState.action !== key) return null;
    if (inlineState.status === "ok") {
      if (inlineState.action === "checkout_template_defaults") {
        return <div className="field-hint">Catálogos base creados.</div>;
      }
      return <div className="field-hint">Guardado.</div>;
    }
    if (inlineState.status === "fail") {
      if (inlineState.action === "checkout_template_defaults") {
        const msg =
          inlineState.errorText === "nothing_to_create"
            ? "No hay productos para crear catálogos base."
            : "No se pudieron crear catálogos base. Revisa productos y canales.";
        return (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            {msg}
          </div>
        );
      }
      if (inlineState.errorText?.startsWith("cart_mixed_collection")) {
        return (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            El catálogo no puede mezclar planes y suscripciones. Elige solo un tipo.
          </div>
        );
      }
      if (inlineState.errorText?.startsWith("invalid_body")) {
        return (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            Faltan datos obligatorios. Completa los campos requeridos.
          </div>
        );
      }
      if (inlineState.errorText?.startsWith("tenant_required")) {
        return (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            Debes seleccionar un canal de ventas para la plantilla.
          </div>
        );
      }
      if (inlineState.errorText?.startsWith("product_required")) {
        return (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            Debes asociar al menos un producto a la plantilla.
          </div>
        );
      }
      if (inlineState.errorText?.startsWith("max_one_product")) {
        return (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            Link de pago y débito automático solo pueden tener un producto asociado.
          </div>
        );
      }
      return (
        <div className="field-hint" style={{ color: "var(--danger)" }}>
          Error: {inlineState.errorText || "unknown_error"}
        </div>
      );
    }
    return null;
  };

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
      setTimeout(() => productsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return false;
    }
    setLocalError("");
    return true;
  }

  const wizardBody = (
    <div className="panel module" style={{ marginTop: 12 }}>
      {!editModalOpen && !createModalOpen ? (
        <div className="panel-header">
          <strong>{editing ? "Editar plantilla" : "Nueva plantilla"}</strong>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STEPS.map((s, idx) => {
            const blockKind = idx > 0 && !selectedKind;
            const blockName = idx > 1 && !name.trim();
            const blockTenant = idx > 1 && missingTenant;
            const blockProducts = idx > 3 && !isProductsValid;
            const blocked = blockKind || blockName || blockTenant || blockProducts;
            return (
              <button
                key={s.id}
                type="button"
                className={idx === stepIndex ? "primary" : "ghost"}
                onClick={() => {
                  if (blocked) {
                    if (blockKind) setLocalError("Selecciona el tipo de plantilla.");
                    else if (blockName) setLocalError("Debes ingresar el nombre interno.");
                    else if (blockTenant) setLocalError("Selecciona el canal de ventas.");
                    else if (blockProducts) setLocalError("Debes seleccionar un producto.");
                    return;
                  }
                  setLocalError("");
                  setStepIndex(idx);
                }}
                disabled={blocked}
              >
                {idx + 1}. {s.label}
              </button>
            );
          })}
        </div>

          {stepIndex === 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="field-hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <strong>Tipo de plantilla</strong>
                <HelpTip text="Link de pago = cobro único. Suscripción = débito automático. Catálogo = selección de productos." />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <label
                  className={`card cardPad ${kind === "PLAN" ? "is-active" : ""}`}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    borderColor: kind === "PLAN" ? "var(--primary)" : missingKind ? "var(--danger)" : "var(--stroke)",
                    background: kind === "PLAN" ? "rgba(14, 165, 233, 0.08)" : "transparent",
                    boxShadow: kind === "PLAN" ? "0 0 0 2px rgba(14, 165, 233, 0.25)" : "none"
                  }}
                  onClick={() => setKind("PLAN")}
                  role="button"
                  aria-pressed={kind === "PLAN"}
                  ref={typeRef}
                >
                  <input
                    type="radio"
                    name="templateKind"
                    value="PLAN"
                    checked={kind === "PLAN"}
                    onChange={() => setKind("PLAN")}
                    style={{ display: "none" }}
                  />
                  <strong>Link de pago</strong>
                  <div className="field-hint">Cobro único con link directo.</div>
                </label>
                <label
                  className={`card cardPad ${kind === "SUBSCRIPTION" ? "is-active" : ""}`}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    borderColor: kind === "SUBSCRIPTION" ? "var(--primary)" : missingKind ? "var(--danger)" : "var(--stroke)",
                    background: kind === "SUBSCRIPTION" ? "rgba(14, 165, 233, 0.08)" : "transparent",
                    boxShadow: kind === "SUBSCRIPTION" ? "0 0 0 2px rgba(14, 165, 233, 0.25)" : "none"
                  }}
                  onClick={() => setKind("SUBSCRIPTION")}
                  role="button"
                  aria-pressed={kind === "SUBSCRIPTION"}
                >
                  <input
                    type="radio"
                    name="templateKind"
                    value="SUBSCRIPTION"
                    checked={kind === "SUBSCRIPTION"}
                    onChange={() => setKind("SUBSCRIPTION")}
                    style={{ display: "none" }}
                  />
                  <strong>Suscripción</strong>
                  <div className="field-hint">Cobro recurrente con débito automático.</div>
                </label>
                <label
                  className={`card cardPad ${kind === "CART" ? "is-active" : ""}`}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    borderColor: kind === "CART" ? "var(--primary)" : missingKind ? "var(--danger)" : "var(--stroke)",
                    background: kind === "CART" ? "rgba(14, 165, 233, 0.08)" : "transparent",
                    boxShadow: kind === "CART" ? "0 0 0 2px rgba(14, 165, 233, 0.25)" : "none"
                  }}
                  onClick={() => setKind("CART")}
                  role="button"
                  aria-pressed={kind === "CART"}
                >
                  <input
                    type="radio"
                    name="templateKind"
                    value="CART"
                    checked={kind === "CART"}
                    onChange={() => setKind("CART")}
                    style={{ display: "none" }}
                  />
                  <strong>Catálogo</strong>
                  <div className="field-hint">Selecciona productos desde el checkout.</div>
                </label>
              </div>
            </div>
          ) : null}

          <form
            action={formAction}
            onSubmit={(e) => {
              if (!validateAndFocus()) {
                e.preventDefault();
              }
            }}
            style={{ display: "grid", gap: 10 }}
          >
            <input type="hidden" name="csrf" value={csrfToken} />
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

            {stepIndex === 1 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Nombre interno
                    <HelpTip text="Solo visible en el panel. Útil para identificar la plantilla." />
                  </label>
                  <input
                    className="input"
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    style={missingName && stepIndex === 1 ? { borderColor: "var(--danger)" } : undefined}
                    ref={nameRef}
                  />
                </div>
                {requireTenant ? (
                  <div className="field">
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      Canal de ventas
                      <HelpTip text="Define el tenant/canal que usará esta plantilla." />
                    </label>
                  <select
                    className="select"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    style={missingTenant && stepIndex === 1 ? { borderColor: "var(--danger)" } : undefined}
                    ref={tenantRef}
                  >
                    <option value="">Selecciona un canal</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {missingTenant ? (
                    <div className="field-hint" style={{ color: "var(--danger)" }}>
                      Selecciona el canal de ventas.
                    </div>
                  ) : null}
                </div>
              ) : null}
                <div className="field row">
                  <label>Activa</label>
                  <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} />
                </div>
                <div className="panel module" style={{ margin: 0 }}>
                  <div className="panel-header">
                    <strong>Mensajes Wompi</strong>
                  </div>
                  <div className="field">
                    <label>{selectedKind === "SUBSCRIPTION" ? "Título suscripción" : "Título plan"}</label>
                    <input className="input" value={wompiTitle} onChange={(e) => setWompiTitle(e.target.value)} placeholder="Título" />
                  </div>
                  <div className="field">
                    <label>{selectedKind === "SUBSCRIPTION" ? "Descripción suscripción" : "Descripción plan"}</label>
                    <textarea
                      className="input"
                      rows={1}
                      value={wompiDescription}
                      onChange={(e) => setWompiDescription(e.target.value)}
                      onInput={(e) => autoResizeTextarea(e.currentTarget)}
                      placeholder="Descripción corta"
                    />
                  </div>
                </div>
                <input type="hidden" name="utmParams" value={utmParams} />
              </div>
            ) : null}

            {stepIndex === 2 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Logo
                    <HelpTip text="Se muestra en el checkout público." />
                  </label>
                  <div className="file-row">
                    <input type="file" accept="image/*" onChange={onLogoFile} />
                    {logoUrl ? <img src={logoUrl} alt="Logo" className="logo-preview" /> : null}
                  </div>
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Color principal
                    <HelpTip text="Color de botones y acentos del checkout." />
                  </label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="color" value={primaryColor || "#1f2937"} onChange={(e) => setPrimaryColor(e.target.value)} />
                    <input className="input" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#0ea5e9" />
                  </div>
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Tipografía (opcional)
                    <HelpTip text="Si la dejas vacía se usa la fuente por defecto." />
                  </label>
                  <input className="input" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="'Source Sans 3', sans-serif" />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Soporte (email)
                    <HelpTip text="Email visible para asistencia del cliente." />
                  </label>
                  <input className="input" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="soporte@tu-dominio.com" />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Soporte (URL)
                    <HelpTip text="URL de soporte (ej: WhatsApp o landing)." />
                  </label>
                  <input className="input" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://wa.me/57..." />
                </div>
                {selectedKind === "PLAN" ? (
                  <div className="field">
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      Texto del botón de pago
                      <HelpTip text="Texto principal del CTA en el checkout." />
                    </label>
                    <input className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Pagar" />
                  </div>
                ) : null}
              </div>
            ) : null}

            {stepIndex === 3 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="field" ref={productsRef}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isCart ? "Productos disponibles" : "Producto asociado"}
                    <HelpTip text={isCart ? "Selecciona los productos disponibles en el checkout público." : "Cada checkout público solo puede asociarse a un producto."} />
                  </label>
                  <input
                    className="input"
                    type="search"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    placeholder="Buscar producto por nombre o SKU..."
                    aria-label="Buscar producto"
                    style={{ marginBottom: 8 }}
                  />
                  <div style={{ display: "grid", gap: 8 }}>
                    {filteredProducts.map((p) => {
                      const selection = productIds.find((item) => String(item.id) === String(p.id));
                      const activeItem = Boolean(selection);
                      const currentMode = selection?.mode || "AUTO_LINK";
                      const productMode = String((p as any)?.collectionMode || "AUTO_LINK").toUpperCase() === "AUTO_DEBIT" ? "AUTO_DEBIT" : "AUTO_LINK";
                      return (
                        <div
                          key={p.id}
                          className={`card cardPad ${activeItem ? "is-active" : ""}`}
                          style={{ display: "grid", gridTemplateColumns: isCart ? "1fr 180px" : "1fr", gap: 10, alignItems: "center", padding: "8px 10px", ...(missingProducts && stepIndex === 3 ? { borderColor: "var(--danger)" } : {}) }}
                        >
                          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                            <input
                              type={isCart ? "checkbox" : "radio"}
                              name="templateProduct"
                              checked={activeItem}
                              onChange={() => {
                                const resolvedMode = isCart ? "AUTO_LINK" : productMode;
                                if (isCart) {
                                  setProductIds((current) =>
                                    activeItem
                                      ? current.filter((item) => String(item.id) !== String(p.id))
                                      : [...current, { id: p.id, mode: resolvedMode }]
                                  );
                                } else {
                                  setProductIds([{ id: p.id, mode: resolvedMode }]);
                                }
                              }}
                            />
                            <span>{p.name}</span>
                          </label>
                          {isCart ? (
                            <div style={{ display: "grid", gap: 6 }}>
                              <label className="field-hint" style={{ margin: 0 }}>
                                Tipo de cobro
                              </label>
                              <select
                                className="select"
                                value={activeItem ? currentMode : ""}
                                disabled={!activeItem}
                                onChange={(e) => {
                                  const nextMode = String(e.target.value || "AUTO_LINK").toUpperCase() === "AUTO_DEBIT" ? "AUTO_DEBIT" : "AUTO_LINK";
                                  setProductIds((current) =>
                                    current.map((item) => (String(item.id) === String(p.id) ? { ...item, mode: nextMode } : item))
                                  );
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
                  {filteredProducts.length === 0 ? (
                    <div className="field-hint">No hay productos que coincidan con la búsqueda.</div>
                  ) : null}
                  {!isProductsValid ? (
                    <div className="field-hint" style={{ color: "var(--danger)" }}>
                      Debes seleccionar un producto.
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Expiración
                    <HelpTip text="Tiempo de validez del checkout público." />
                  </label>
                  <select className="select" name="expiryHours" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)}>
                    <option value="1">1 hora</option>
                    <option value="6">6 horas</option>
                    <option value="13">13 horas</option>
                    <option value="24">24 horas</option>
                    <option value="">Nunca</option>
                  </select>
                </div>
                {selectedKind === "PLAN" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div className="field-hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      Campos visibles en el checkout
                      <HelpTip text="Solo aplica para link de pago (plan)." />
                    </div>
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
                  </div>
                ) : null}
              </div>
            ) : null}

            {stepIndex === 4 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="field-hint">Revisa la configuración antes de guardar.</div>
                {localError ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    {localError}
                  </div>
                ) : null}
                {(missingKind || missingName || missingTenant || missingProducts) ? (
                  <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                    Faltan datos obligatorios:
                    <ul style={{ margin: "6px 0 0 16px" }}>
                      {missingKind ? <li>Selecciona tipo (Link de pago o Débito automático).</li> : null}
                      {missingName ? <li>Nombre interno.</li> : null}
                      {missingTenant ? <li>Canal de ventas.</li> : null}
                      {missingProducts ? <li>Selecciona un producto.</li> : null}
                    </ul>
                  </div>
                ) : null}
                <div className="card cardPad">
                  <div style={{ display: "grid", gap: 8 }}>
                    <div><strong>Tipo:</strong> {selectedKind || "—"}</div>
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
                </div>
                {!isProductsValid ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Debes seleccionar un producto.
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="module-footer">
              <button 
                className="ghost btn-compact btn-back" 
                type="button" 
                data-loader="off" 
                onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
                disabled={stepIndex === 0}
                title="Volver al paso anterior"
                aria-label="Atrás"
              >
                Atrás
              </button>
              {stepIndex < STEPS.length - 1 ? (
                <button
                  className="primary btn-compact btn-next"
                  type="button"
                  data-loader="off"
                  onClick={() => {
                    if (stepIndex === 0 && !kind) {
                      setLocalError("Selecciona el tipo de plantilla.");
                      return;
                    }
                    if (stepIndex === 1 && !name.trim()) {
                      setLocalError("Debes ingresar el nombre interno.");
                      return;
                    }
                    if (stepIndex === 1 && missingTenant) {
                      setLocalError("Selecciona el canal de ventas.");
                      return;
                    }
                    if (stepIndex === 3 && !isProductsValid) {
                      setLocalError("Debes seleccionar un producto.");
                      return;
                    }
                    setLocalError("");
                    setStepIndex(Math.min(STEPS.length - 1, stepIndex + 1));
                  }}
                  disabled={(stepIndex === 0 && !kind) || (stepIndex === 1 && (!name.trim() || missingTenant)) || (stepIndex === 3 && !isProductsValid)}
                  title="Ir al siguiente paso"
                  aria-label="Siguiente"
                >
                  Siguiente
                </button>
              ) : (
                <PendingButton
                  className="primary btn-compact btn-save"
                  type="submit"
                  pendingText="Guardando..."
                  disabled={!selectedKind || !name || missingTenant || !isProductsValid}
                  title="Guardar plantilla de checkout"
                  aria-label="Guardar cambios"
                >
                  {editing ? "Guardar" : "Guardar plantilla"}
                </PendingButton>
              )}
            </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="panel module">
      <div className="panelHeaderRow checkout-templates-header">
        <div className="checkout-templates-header-copy">
          <strong>Plantillas</strong>
          <div className="field-hint">Paso 1: crea plantillas. Paso 2: define predeterminadas abajo.</div>
        </div>
        <div className="checkout-templates-header-actions">
          {editing ? (
            <button className="ghost btn-cancel" type="button" onClick={resetWizard} data-loader="off">
              Cancelar edición
            </button>
          ) : null}
          <button className="primary btn-compact btn-create" type="button" data-modal="true" data-loader="off" onClick={openCreate}>
            Nueva plantilla
          </button>
        </div>
      </div>

      <AppModal open={Boolean(editing && editModalOpen)} onClose={resetWizard} title="Editar plantilla" maxWidth={900}>
        {wizardBody}
      </AppModal>

      <AppModal open={createModalOpen} onClose={resetWizard} title="Nueva plantilla" maxWidth={900}>
        {wizardBody}
      </AppModal>

      {!templates.length ? <div className="field-hint">Aún no hay plantillas. Crea una para poder asignarla como predeterminada.</div> : null}
      <div className="template-grid">
        {templates.map((t) => (
          <div key={t.id} className={`template-card ${t.active ? "" : "is-disabled"}`}>
            <div className="template-card-top">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {t.logoUrl ? <img src={t.logoUrl} alt={t.name} style={{ height: 26, width: "auto", borderRadius: 6, border: "1px solid var(--stroke)" }} /> : null}
                  <div className="template-title">{t.name}</div>
                </div>
                <div className="field-hint">{t.kind === "PLAN" ? "Link de pago" : t.kind === "CART" ? "Catálogo" : "Débito automático"}</div>
              </div>
              <div className="template-card-head-actions">
                <form
                  className="template-card-delete"
                  action={actions.remove}
                  onSubmit={(e) => {
                    if (!confirm("¿Eliminar esta plantilla?")) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="id" value={t.id} />
                  <PendingButton className="ghost btn-compact btn-red btn-delete-icon" type="submit" pendingText="Eliminando..." aria-label="Eliminar plantilla" title="Eliminar plantilla">
                    Eliminar
                  </PendingButton>
                </form>
                <div className="template-card-statuses">
                  <span className={`pill ${t.active ? "pill-green" : ""}`}>{t.active ? "Activa" : "Inactiva"}</span>
                </div>
              </div>
            </div>
            <div className="template-meta template-meta-compact">
              <div>
                <div className="field-hint">Productos</div>
                <div className="template-meta-value">
                  {(Array.isArray(t.productIds) ? t.productIds : [])
                    .map((entry: any) => {
                      if (typeof entry === "string") return productById.get(String(entry))?.name || "—";
                      const id = String(entry?.id || "");
                      const mode = String(entry?.mode || "AUTO_LINK").toUpperCase() === "AUTO_DEBIT" ? "Débito automático" : "Link de pago";
                      return `${productById.get(id)?.name || "—"}${t.kind === "CART" ? ` (${mode})` : ""}`;
                    })
                    .slice(0, 1)
                    .join(", ") || "—"}
                </div>
              </div>
              <div>
                <div className="field-hint">Expira</div>
                <div className="template-meta-value">{t.expiryHours ? `${t.expiryHours}h` : "Nunca"}</div>
              </div>
            </div>
            <div className="template-actions">
              <button className="secondary btn-compact" type="button" data-modal="true" data-loader="off" onClick={() => openEdit(t)}>
                Editar
              </button>
              <form action={actions.duplicate}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="id" value={t.id} />
                <PendingButton className="ghost btn-compact" type="submit" pendingText="Duplicando...">Duplicar</PendingButton>
              </form>
            </div>
          </div>
        ))}
      </div>

      {/* ── Paso 2: Plantillas predeterminadas ──────────────────────────────── */}
      <div style={{ borderTop: "1px dashed var(--stroke)", marginTop: 16, paddingTop: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>Predeterminadas</strong>
          <div className="field-hint">Plantilla usada cuando no hay una asignada al producto específico.</div>
          {inlineState.action === "checkout_defaults" && inlineState.status === "ok" && (
            <div className="field-hint" style={{ color: "var(--success)" }}>Predeterminadas guardadas.</div>
          )}
          {inlineState.action === "checkout_defaults" && inlineState.status === "fail" && (
            <div className="field-hint" style={{ color: "var(--danger)" }}>Error al guardar.</div>
          )}
        </div>
        <form action={actions.saveDefaults} style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="csrf" value={csrfToken} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <label className="field-group">
              <span className="field-label">Link de pago (PLAN)</span>
              <select name="defaultPlanTemplateId" className="select" defaultValue={checkoutDefaults?.defaultPlanTemplateId || ""}>
                <option value="">— Sin predeterminada —</option>
                {templates.filter(t => t.kind === "PLAN" && t.active).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">Débito automático (SUBSCRIPTION)</span>
              <select name="defaultSubscriptionTemplateId" className="select" defaultValue={checkoutDefaults?.defaultSubscriptionTemplateId || ""}>
                <option value="">— Sin predeterminada —</option>
                {templates.filter(t => t.kind === "SUBSCRIPTION" && t.active).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">Catálogo (CART)</span>
              <select name="defaultCartTemplateId" className="select" defaultValue={checkoutDefaults?.defaultCartTemplateId || ""}>
                <option value="">— Sin predeterminada —</option>
                {templates.filter(t => t.kind === "CART" && t.active).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <PendingButton className="primary btn-compact" type="submit" pendingText="Guardando...">Guardar predeterminadas</PendingButton>
          </div>
        </form>
      </div>
    </div>
  );
}
