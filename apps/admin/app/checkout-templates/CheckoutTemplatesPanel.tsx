"use client";

import { useMemo, useState } from "react";
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
  kind: "PLAN" | "SUBSCRIPTION";
  active: boolean;
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

type Product = { id: string; name: string; sku?: string };

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

export function CheckoutTemplatesPanel({
  templates,
  products,
  csrfToken,
  inlineState,
  initialKind = "",
  initialStep = "choose",
  actions
}: {
  templates: Template[];
  products: Product[];
  csrfToken: string;
  inlineState: { action: string; status: string; errorText: string };
  initialKind?: "PLAN" | "SUBSCRIPTION" | "";
  initialStep?: "choose" | "form";
  actions: {
    create: (formData: FormData) => void;
    update: (formData: FormData) => void;
    remove: (formData: FormData) => void;
  };
}) {
  const [stepIndex, setStepIndex] = useState<number>(initialStep === "form" ? 1 : 0);
  const [editing, setEditing] = useState<Template | null>(null);
  const [kind, setKind] = useState<"PLAN" | "SUBSCRIPTION" | "">(
    initialKind === "PLAN" ? "PLAN" : initialKind === "SUBSCRIPTION" ? "SUBSCRIPTION" : ""
  );

  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [allowSelect, setAllowSelect] = useState(false);
  const [productIds, setProductIds] = useState<string[]>([]);
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

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  function resetWizard() {
    setEditing(null);
    setKind("");
    setName("");
    setActive(true);
    setAllowSelect(false);
    setProductIds([]);
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
    setKind(t.kind);
    setName(t.name || "");
    setActive(Boolean(t.active));
    setAllowSelect(Boolean(t.allowProductSelect));
    setProductIds(Array.isArray(t.productIds) ? t.productIds : []);
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
  const isProductsValid = allowSelect || productIds.length > 0;

  const inlineMsg = (key: string) => {
    if (inlineState.action !== key) return null;
    if (inlineState.status === "ok") return <div className="field-hint">Guardado.</div>;
    if (inlineState.status === "fail") {
      return (
        <div className="field-hint" style={{ color: "var(--danger)" }}>
          Error: {inlineState.errorText || "unknown_error"}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="panel module">
      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Plantillas</strong>
          <div className="field-hint">Wizard para crear plantillas de checkout público.</div>
        </div>
        {editing ? (
          <button className="ghost" type="button" onClick={resetWizard}>
            Cancelar edición
          </button>
        ) : null}
      </div>

      <div className="panel module" style={{ marginTop: 12 }}>
        <div className="panel-header">
          <strong>{editing ? "Editar plantilla" : "Nueva plantilla"}</strong>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {STEPS.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                className={idx === stepIndex ? "primary" : "ghost"}
                onClick={() => setStepIndex(idx)}
              >
                {idx + 1}. {s.label}
              </button>
            ))}
          </div>

          {stepIndex === 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="field-hint">Selecciona el tipo de plantilla.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label
                  className={`card cardPad ${kind === "PLAN" ? "is-active" : ""}`}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    borderColor: kind === "PLAN" ? "var(--primary)" : "var(--stroke)",
                    background: kind === "PLAN" ? "rgba(14, 165, 233, 0.08)" : "transparent",
                    boxShadow: kind === "PLAN" ? "0 0 0 2px rgba(14, 165, 233, 0.25)" : "none"
                  }}
                  onClick={() => setKind("PLAN")}
                  role="button"
                  aria-pressed={kind === "PLAN"}
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
                    borderColor: kind === "SUBSCRIPTION" ? "var(--primary)" : "var(--stroke)",
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
              </div>
            </div>
          ) : null}

          <form action={formAction} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <input type="hidden" name="kind" value={selectedKind} />
            <input type="hidden" name="logoUrl" value={logoUrl} />
            <input type="hidden" name="productIds" value={productIds.join(",")} />
            <input type="hidden" name="layout" value={JSON.stringify(layoutPayload)} />
            <input type="hidden" name="wompiTitle" value={wompiTitle || publicTitle} />
            <input type="hidden" name="wompiDescription" value={wompiDescription || publicDescription} />

            {stepIndex === 1 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="field">
                  <label>Nombre interno</label>
                  <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="field row">
                  <label>Activa</label>
                  <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} />
                </div>
                <div className="field">
                  <label>Título público</label>
                  <input className="input" name="publicTitle" value={publicTitle} onChange={(e) => setPublicTitle(e.target.value)} placeholder="Checkout" />
                </div>
                <div className="field">
                  <label>Descripción pública</label>
                  <textarea className="input" name="publicDescription" rows={2} value={publicDescription} onChange={(e) => setPublicDescription(e.target.value)} placeholder="Descripción corta" />
                </div>
                <div className="field">
                  <label>UTM (opcional)</label>
                  <input className="input" name="utmParams" value={utmParams} onChange={(e) => setUtmParams(e.target.value)} placeholder="utm_source=apiflujos&utm_campaign=plan" />
                  <div className="field-hint">Se agrega al final del link. No incluyas el signo ?</div>
                </div>
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
                <div className="field row">
                  <label>El cliente puede elegir producto</label>
                  <input type="checkbox" name="allowProductSelect" checked={allowSelect} onChange={(e) => setAllowSelect(e.target.checked)} />
                </div>
                <div className="field">
                  <label>Productos disponibles</label>
                  <div className="field-add">
                    {products.map((p) => {
                      const activeItem = productIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`ghost ${activeItem ? "is-active" : ""}`}
                          onClick={() => {
                            if (activeItem) setProductIds(productIds.filter((id) => id !== p.id));
                            else setProductIds([...productIds, p.id]);
                          }}
                        >
                          {activeItem ? "✓ " : "+ "}
                          {p.name}
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
                <div className="card cardPad">
                  <div style={{ display: "grid", gap: 8 }}>
                    <div><strong>Tipo:</strong> {selectedKind || "—"}</div>
                    <div><strong>Nombre:</strong> {name || "—"}</div>
                    <div><strong>Activa:</strong> {active ? "Sí" : "No"}</div>
                    <div><strong>Productos:</strong> {allowSelect ? "Selector habilitado" : productIds.map((id) => productById.get(id)?.name || "—").join(", ") || "—"}</div>
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
                  <button className="primary" type="button" onClick={() => setStepIndex(Math.min(STEPS.length - 1, stepIndex + 1))} disabled={stepIndex === 0 && !kind}>
                    Siguiente
                  </button>
                ) : (
                  <PendingButton className="primary" type="submit" pendingText="Guardando..." disabled={!selectedKind || !name || !isProductsValid}>
                    {editing ? "Guardar cambios" : "Guardar plantilla"}
                  </PendingButton>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>

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
                <div className="field-hint">{t.kind === "PLAN" ? "Plan" : "Suscripción"}</div>
              </div>
              <span className={`pill ${t.active ? "pill-green" : ""}`}>{t.active ? "Activa" : "Inactiva"}</span>
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
              <form action={actions.remove}>
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
