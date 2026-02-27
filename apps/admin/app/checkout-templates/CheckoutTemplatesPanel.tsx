"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

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
  productIds?: string[] | null;
  expiryHours?: number | null;
  logoUrl?: string | null;
  publicTitle?: string | null;
  publicDescription?: string | null;
  wompiTitle?: string | null;
  wompiDescription?: string | null;
  utmParams?: string | null;
  layout?: Layout | null;
};

type Product = { id: string; name: string; sku?: string; collectionMode?: string | null };
type Tenant = { id: string; name: string };

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
  actions
}: {
  templates: Template[];
  products: Product[];
  tenants: Tenant[];
  csrfToken: string;
  inlineState: { action: string; status: string; errorText: string };
  initialKind?: "PLAN" | "SUBSCRIPTION" | "";
  initialStep?: "choose" | "form";
  actions: {
    create: (formData: FormData) => void;
    update: (formData: FormData) => void;
    remove: (formData: FormData) => void;
    duplicate: (formData: FormData) => void;
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
  const [catalogMode, setCatalogMode] = useState<"" | "PLAN" | "SUBSCRIPTION">("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState("");
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

  function resetWizard() {
    setEditing(null);
    setEditModalOpen(false);
    setCreateModalOpen(false);
    setKind("");
    setName("");
    setActive(true);
    setAllowSelect(true);
    setCatalogMode("");
    setProductIds([]);
    setTenantId("");
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
    setCatalogMode("");
    setProductIds(Array.isArray(t.productIds) ? t.productIds : []);
    setTenantId(String(t.tenantId || ""));
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
  const isProductsValid = isCart ? productIds.length > 0 : allowSelect || productIds.length > 0;
  const missingCatalogMode = isCart && !catalogMode;
  const missingKind = !selectedKind;
  const missingName = !name.trim();
  const requireTenant = Array.isArray(tenants) && tenants.length > 0;
  const missingTenant = requireTenant && !tenantId;
  const missingProducts = !isProductsValid;
  const [localError, setLocalError] = useState<string>("");

  const filteredProducts = useMemo(() => {
    if (!selectedKind || selectedKind === "CART") return products;
    const mode = selectedKind === "SUBSCRIPTION" ? "AUTO_DEBIT" : "AUTO_LINK";
    const filtered = products.filter((p) => !p.collectionMode || p.collectionMode === mode);
    return filtered.length ? filtered : products;
  }, [products, selectedKind]);

  const filteredCatalogProducts = useMemo(() => {
    if (selectedKind !== "CART") return products;
    const mode = catalogMode === "SUBSCRIPTION" ? "AUTO_DEBIT" : "AUTO_LINK";
    const filtered = products.filter((p) => !p.collectionMode || p.collectionMode === mode);
    return filtered.length ? filtered : products;
  }, [products, selectedKind, catalogMode]);

  useEffect(() => {
    if (requireTenant && tenants.length === 1 && !tenantId) {
      setTenantId(tenants[0].id);
    }
  }, [requireTenant, tenants, tenantId]);

  useEffect(() => {
    if (selectedKind === "CART" && !allowSelect) {
      setAllowSelect(true);
    }
  }, [selectedKind, allowSelect]);

  useEffect(() => {
    if (selectedKind !== "CART") return;
    setProductIds([]);
  }, [selectedKind, catalogMode]);

  const inlineMsg = (key: string) => {
    if (inlineState.action !== key) return null;
    if (inlineState.status === "ok") return <div className="field-hint">Guardado.</div>;
    if (inlineState.status === "fail") {
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
    if (missingCatalogMode) {
      setStepIndex(3);
      setLocalError("Selecciona si el catálogo es Plan o Suscripción.");
      setTimeout(() => productsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return false;
    }
    if (!isProductsValid) {
      setStepIndex(3);
      setLocalError("Debes seleccionar productos o permitir el selector.");
      setTimeout(() => productsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return false;
    }
    setLocalError("");
    return true;
  }

  const wizardBody = (
    <div className="panel module" style={{ marginTop: 12 }}>
      {!(editing && editModalOpen) ? (
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
                    else if (blockProducts) setLocalError("Debes seleccionar productos o permitir el selector.");
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
              <div className="field-hint">Selecciona el tipo de plantilla.</div>
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
                  <strong>Plan</strong>
                  <div className="field-hint">Checkout de pago / link.</div>
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
                  <div className="field-hint">Checkout de tokenización.</div>
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
                  <div className="field-hint">Checkout con selección de productos.</div>
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
            <input type="hidden" name="allowProductSelect" value={allowSelect ? "on" : ""} />
            <input type="hidden" name="logoUrl" value={logoUrl} />
            <input type="hidden" name="productIds" value={productIds.join(",")} />
            <input type="hidden" name="layout" value={JSON.stringify(layoutPayload)} />
            <input type="hidden" name="publicTitle" value={wompiTitle || publicTitle} />
            <input type="hidden" name="publicDescription" value={wompiDescription || publicDescription} />
            <input type="hidden" name="wompiTitle" value={wompiTitle || publicTitle} />
            <input type="hidden" name="wompiDescription" value={wompiDescription || publicDescription} />

            {stepIndex === 1 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="field">
                  <label>Nombre interno</label>
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
                    <label>Canal de ventas</label>
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
                  <label>Logo</label>
                  <div className="file-row">
                    <input type="file" accept="image/*" onChange={onLogoFile} />
                    {logoUrl ? <img src={logoUrl} alt="Logo" className="logo-preview" /> : null}
                  </div>
                </div>
                <div className="field">
                  <label>Color principal</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="color" value={primaryColor || "#1f2937"} onChange={(e) => setPrimaryColor(e.target.value)} />
                    <input className="input" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#0ea5e9" />
                  </div>
                </div>
                <div className="field">
                  <label>Tipografía (opcional)</label>
                  <input className="input" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="'Source Sans 3', sans-serif" />
                </div>
                <div className="field">
                  <label>Soporte (email)</label>
                  <input className="input" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="soporte@tu-dominio.com" />
                </div>
                <div className="field">
                  <label>Soporte (URL)</label>
                  <input className="input" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://wa.me/57..." />
                </div>
                {selectedKind === "PLAN" ? (
                  <div className="field">
                    <label>Texto del botón de pago</label>
                    <input className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Pagar" />
                  </div>
                ) : null}
              </div>
            ) : null}

            {stepIndex === 3 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {selectedKind !== "CART" ? (
                  <div className="field row">
                    <label>El cliente puede elegir producto</label>
                    <input type="checkbox" name="allowProductSelect" checked={allowSelect} onChange={(e) => setAllowSelect(e.target.checked)} />
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="field">
                      <label>Tipo de catálogo</label>
                      <select
                        className="select"
                        value={catalogMode}
                        onChange={(e) => setCatalogMode(e.target.value as any)}
                        style={missingCatalogMode ? { borderColor: "var(--danger)" } : undefined}
                      >
                        <option value="">Selecciona un tipo</option>
                        <option value="PLAN">Plan (link de pago)</option>
                        <option value="SUBSCRIPTION">Suscripción (tokenización)</option>
                      </select>
                    </div>
                    <div className="field-hint">
                      Plan: el cliente paga con un link. Suscripción: el cliente tokeniza tarjeta para cobros automáticos.
                    </div>
                    {missingCatalogMode ? (
                      <div className="field-hint" style={{ color: "var(--danger)" }}>
                        Selecciona el tipo de catálogo.
                      </div>
                    ) : null}
                  </div>
                )}
                <div className="field" ref={productsRef}>
                  <label>Productos disponibles</label>
                  <div style={{ display: "grid", gap: 8 }}>
                    {(selectedKind === "CART" ? filteredCatalogProducts : filteredProducts).map((p) => {
                      const activeItem = productIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`ghost ${activeItem ? "is-active" : ""}`}
                          style={{ justifyContent: "space-between", width: "100%", ...(missingProducts && stepIndex === 3 ? { borderColor: "var(--danger)" } : {}) }}
                          onClick={() => {
                            if (activeItem) setProductIds(productIds.filter((id) => id !== p.id));
                            else setProductIds([...productIds, p.id]);
                          }}
                        >
                          <span>{p.name}</span>
                          <span>{activeItem ? "✓" : "+"}</span>
                        </button>
                      );
                    })}
                  </div>
                  {!isProductsValid ? (
                    <div className="field-hint" style={{ color: "var(--danger)" }}>
                      Debes seleccionar productos o permitir el selector.
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label>Expiración</label>
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
                    <div className="field-hint">Campos visibles en el checkout.</div>
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
                {(missingKind || missingName || missingTenant || missingProducts || missingCatalogMode) ? (
                  <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                    Faltan datos obligatorios:
                    <ul style={{ margin: "6px 0 0 16px" }}>
                      {missingKind ? <li>Selecciona tipo (Plan o Suscripción).</li> : null}
                      {missingName ? <li>Nombre interno.</li> : null}
                      {missingTenant ? <li>Canal de ventas.</li> : null}
                      {missingCatalogMode ? <li>Selecciona si el catálogo es Plan o Suscripción.</li> : null}
                      {missingProducts ? <li>Selecciona productos o activa “El cliente puede elegir producto”.</li> : null}
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
                      {isCart ? productIds.map((id) => productById.get(id)?.name || "—").join(", ") || "—" : allowSelect ? "Selector habilitado" : productIds.map((id) => productById.get(id)?.name || "—").join(", ") || "—"}
                    </div>
                    <div><strong>Expiración:</strong> {expiryHours ? `${expiryHours}h` : "Nunca"}</div>
                    <div><strong>Soporte:</strong> {supportEmail || supportUrl || "—"}</div>
                    <div><strong>Color:</strong> {primaryColor || "—"}</div>
                  </div>
                </div>
                {!isProductsValid ? (
                  <div className="field-hint" style={{ color: "var(--danger)" }}>
                    Debes seleccionar productos o permitir el selector.
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>{inlineMsg(editing ? "checkout_template_update" : "checkout_template_create")}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ghost" type="button" onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}>
                  Atrás
                </button>
                {stepIndex < STEPS.length - 1 ? (
                  <button
                    className="primary"
                    type="button"
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
                    if (stepIndex === 3 && missingCatalogMode) {
                      setLocalError("Selecciona si el catálogo es Plan o Suscripción.");
                      return;
                    }
                    if (stepIndex === 3 && !isProductsValid) {
                      setLocalError("Debes seleccionar productos o permitir el selector.");
                      return;
                    }
                      setLocalError("");
                      setStepIndex(Math.min(STEPS.length - 1, stepIndex + 1));
                    }}
                    disabled={(stepIndex === 0 && !kind) || (stepIndex === 1 && (!name.trim() || missingTenant)) || (stepIndex === 3 && (!isProductsValid || missingCatalogMode))}
                  >
                    Siguiente
                  </button>
                ) : (
                  <PendingButton
                    className="primary"
                    type="submit"
                    pendingText="Guardando..."
                    disabled={!selectedKind || !name || missingTenant || !isProductsValid || missingCatalogMode}
                  >
                    {editing ? "Guardar cambios" : "Guardar plantilla"}
                  </PendingButton>
                )}
              </div>
            </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="panel module">
      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Plantillas</strong>
          <div className="field-hint">Wizard para crear plantillas de checkout público.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {editing ? (
            <button className="ghost" type="button" onClick={resetWizard}>
              Cancelar edición
            </button>
          ) : null}
          <button className="primary" type="button" onClick={openCreate}>
            Nueva plantilla
          </button>
        </div>
      </div>

      {editing && editModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 900 }}>
            <div className="panel-header">
              <strong>Editar plantilla</strong>
              <button className="ghost" type="button" onClick={resetWizard} aria-label="Cerrar">
                X
              </button>
            </div>
            {wizardBody}
          </div>
        </div>
      ) : null}

      {createModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 900 }}>
            <div className="panel-header">
              <strong>Nueva plantilla</strong>
              <button className="ghost" type="button" onClick={resetWizard} aria-label="Cerrar">
                X
              </button>
            </div>
            {wizardBody}
          </div>
        </div>
      ) : null}

      {!templates.length ? <div className="field-hint">Aún no hay plantillas.</div> : null}
      <div className="template-grid">
        {templates.map((t) => (
          <div key={t.id} className={`template-card ${t.active ? "" : "is-disabled"}`}>
            <div className="template-card-top">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {t.logoUrl ? <img src={t.logoUrl} alt={t.name} style={{ height: 26, width: "auto", borderRadius: 6, border: "1px solid var(--stroke)" }} /> : null}
                  <div className="template-title">{t.name}</div>
                </div>
                <div className="field-hint">{t.kind === "PLAN" ? "Plan" : t.kind === "CART" ? "Catálogo" : "Suscripción"}</div>
              </div>
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <span className={`pill ${t.active ? "pill-green" : ""}`}>{t.active ? "Activa" : "Inactiva"}</span>
                {(() => {
                  const hasProducts = t.allowProductSelect || (t.productIds || []).length > 0;
                  const hasWompi = Boolean(t.wompiTitle || t.publicTitle) && Boolean(t.wompiDescription || t.publicDescription);
                  const ready = hasProducts && hasWompi;
                  return ready ? <span className="pill pill-ok pill-sm">Listo</span> : null;
                })()}
              </div>
            </div>
            <div className="template-meta">
              <div>
                <div className="field-hint">Productos</div>
                <strong>{t.allowProductSelect ? "Selector" : (t.productIds || []).map((id) => productById.get(id)?.name || "—").join(", ") || "—"}</strong>
              </div>
              <div>
                <div className="field-hint">Expira</div>
                <strong>{t.expiryHours ? `${t.expiryHours}h` : "Nunca"}</strong>
              </div>
            </div>
            <div className="template-actions">
              <button className="secondary" type="button" onClick={() => openEdit(t)}>
                Editar
              </button>
              <form action={actions.duplicate}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="id" value={t.id} />
                <PendingButton className="ghost" type="submit" pendingText="Duplicando...">Duplicar</PendingButton>
              </form>
              <form
                action={actions.remove}
                onSubmit={(e) => {
                  if (!confirm("¿Eliminar esta plantilla?")) e.preventDefault();
                }}
              >
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="id" value={t.id} />
                <PendingButton className="ghost" type="submit" pendingText="Eliminando...">Eliminar</PendingButton>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
