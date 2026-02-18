"use client";

import { useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

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
};

type Product = { id: string; name: string; sku?: string };

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
  const [step, setStep] = useState<"choose" | "form">(initialStep === "form" ? "form" : "choose");
  const [editing, setEditing] = useState<Template | null>(null);
  const [kind, setKind] = useState<"PLAN" | "SUBSCRIPTION" | "">(
    initialKind === "PLAN" ? "PLAN" : initialKind === "SUBSCRIPTION" ? "SUBSCRIPTION" : ""
  );
  const [name, setName] = useState("");
  const [allowSelect, setAllowSelect] = useState(false);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [expiryHours, setExpiryHours] = useState("24");
  const [logoUrl, setLogoUrl] = useState("");
  const [publicTitle, setPublicTitle] = useState("");
  const [publicDescription, setPublicDescription] = useState("");
  const [wompiTitle, setWompiTitle] = useState("");
  const [wompiDescription, setWompiDescription] = useState("");
  const [utmParams, setUtmParams] = useState("");

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  function resetCreateForm() {
    setEditing(null);
    setKind("");
    setName("");
    setAllowSelect(false);
    setProductIds([]);
    setExpiryHours("24");
    setLogoUrl("");
    setPublicTitle("");
    setPublicDescription("");
    setWompiTitle("");
    setWompiDescription("");
    setUtmParams("");
    setStep("choose");
  }

  function openEdit(t: Template) {
    setEditing(t);
    setKind(t.kind);
    setName(t.name || "");
    setAllowSelect(Boolean(t.allowProductSelect));
    setProductIds(Array.isArray(t.productIds) ? t.productIds : []);
    setExpiryHours(t.expiryHours ? String(t.expiryHours) : "24");
    setLogoUrl(t.logoUrl || "");
    setPublicTitle(t.publicTitle || "");
    setPublicDescription(t.publicDescription || "");
    setWompiTitle(t.wompiTitle || "");
    setWompiDescription(t.wompiDescription || "");
    setUtmParams(t.utmParams || "");
    setStep("form");
  }

  const formAction = editing ? actions.update : actions.create;
  const selectedKind = (editing ? editing.kind : kind) || "";
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

  const inlineMsg = (key: string) => {
    if (inlineState.action !== key) return null;
    if (inlineState.status === "ok") return <div className="field-hint">Guardado.</div>;
    if (inlineState.status === "fail") return <div className="field-hint" style={{ color: "var(--danger)" }}>Error: {inlineState.errorText || "unknown_error"}</div>;
    return null;
  };

  return (
    <div className="panel module">
      <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Plantillas</strong>
          <div className="field-hint">Crea plantillas para Plan o Suscripción.</div>
        </div>
      </div>

      <div className="panel module" style={{ marginTop: 12 }}>
        <div className="panel-header">
          <strong>{editing ? "Editar plantilla" : "Nueva plantilla"}</strong>
          {editing ? (
            <button className="ghost" type="button" onClick={resetCreateForm}>
              Cancelar edición
            </button>
          ) : null}
        </div>
        {step === "choose" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="field-hint">Selecciona el tipo de plantilla.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <a
                className={`card cardPad ${kind === "PLAN" ? "is-active" : ""}`}
                href={`/settings?tab=checkout-publico&step=choose&kind=PLAN`}
                onClick={() => setKind("PLAN")}
                style={{ textAlign: "left" }}
              >
                <strong>Plan</strong>
                <div className="field-hint">Checkout de pago / link.</div>
              </a>
              <a
                className={`card cardPad ${kind === "SUBSCRIPTION" ? "is-active" : ""}`}
                href={`/settings?tab=checkout-publico&step=choose&kind=SUBSCRIPTION`}
                onClick={() => setKind("SUBSCRIPTION")}
                style={{ textAlign: "left" }}
              >
                <strong>Suscripción</strong>
                <div className="field-hint">Checkout de tokenización.</div>
              </a>
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <a
                className={`primary ${!kind ? "is-disabled" : ""}`}
                href={kind ? `/settings?tab=checkout-publico&step=form&kind=${kind}` : undefined}
                onClick={() => (kind ? setStep("form") : null)}
                aria-disabled={!kind}
              >
                Siguiente
              </a>
            </div>
          </div>
        ) : (
          <form action={formAction} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <input type="hidden" name="kind" value={selectedKind} />
            <input type="hidden" name="logoUrl" value={logoUrl} />
            <div className="field-hint">La URL pública se genera automáticamente al crear el link.</div>
            <div className="field">
              <label>Nombre</label>
              <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field row">
              <label>Activa</label>
              <input type="checkbox" name="active" defaultChecked />
            </div>
            <div className="field row">
              <label>Selector de productos</label>
              <input type="checkbox" name="allowProductSelect" checked={allowSelect} onChange={(e) => setAllowSelect(e.target.checked)} />
            </div>
            <div className="field">
              <label>Productos</label>
              <input type="hidden" name="productIds" value={productIds.join(",")} />
              <div className="field-add">
                {products.map((p) => {
                  const active = productIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`ghost ${active ? "is-active" : ""}`}
                      onClick={() => {
                        if (active) setProductIds(productIds.filter((id) => id !== p.id));
                        else setProductIds([...productIds, p.id]);
                      }}
                    >
                      {active ? "✓ " : "+ "}
                      {p.name}
                    </button>
                  );
                })}
              </div>
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
            <div className="field">
              <label>Logo</label>
              <div className="file-row">
                <input type="file" accept="image/*" onChange={onLogoFile} />
                {logoUrl ? <img src={logoUrl} alt="Logo" className="logo-preview" /> : null}
              </div>
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
              <label>Wompi Title</label>
              <input className="input" name="wompiTitle" value={wompiTitle} onChange={(e) => setWompiTitle(e.target.value)} placeholder="{producto} · {contacto}" />
            </div>
            <div className="field">
              <label>Wompi Description</label>
              <input className="input" name="wompiDescription" value={wompiDescription} onChange={(e) => setWompiDescription(e.target.value)} placeholder="{producto} · {monto}" />
            </div>
            <div className="field">
              <label>UTM (opcional)</label>
              <input className="input" name="utmParams" value={utmParams} onChange={(e) => setUtmParams(e.target.value)} placeholder="utm_source=apiflujos&utm_campaign=plan" />
              <div className="field-hint">Se agrega al final del link. No incluyas el signo ?</div>
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {inlineMsg(editing ? "checkout_template_update" : "checkout_template_create")}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ghost" type="button" onClick={resetCreateForm}>
                  Atrás
                </button>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  {editing ? "Guardar cambios" : "Guardar plantilla"}
                </PendingButton>
              </div>
            </div>
          </form>
        )}
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
