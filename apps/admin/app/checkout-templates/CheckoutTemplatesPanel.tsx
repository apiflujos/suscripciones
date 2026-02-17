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
};

type Product = { id: string; name: string; sku?: string };

export function CheckoutTemplatesPanel({
  templates,
  products,
  csrfToken,
  inlineState,
  actions
}: {
  templates: Template[];
  products: Product[];
  csrfToken: string;
  inlineState: { action: string; status: string; errorText: string };
  actions: {
    create: (formData: FormData) => void;
    update: (formData: FormData) => void;
    remove: (formData: FormData) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "form">("choose");
  const [editing, setEditing] = useState<Template | null>(null);
  const [kind, setKind] = useState<"PLAN" | "SUBSCRIPTION">("PLAN");
  const [name, setName] = useState("");
  const [allowSelect, setAllowSelect] = useState(false);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [expiryHours, setExpiryHours] = useState("24");
  const [logoUrl, setLogoUrl] = useState("");
  const [publicTitle, setPublicTitle] = useState("");
  const [publicDescription, setPublicDescription] = useState("");
  const [wompiTitle, setWompiTitle] = useState("");
  const [wompiDescription, setWompiDescription] = useState("");

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  function resetCreateForm() {
    setEditing(null);
    setKind("PLAN");
    setName("");
    setAllowSelect(false);
    setProductIds([]);
    setExpiryHours("24");
    setLogoUrl("");
    setPublicTitle("");
    setPublicDescription("");
    setWompiTitle("");
    setWompiDescription("");
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
    setStep("form");
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    setStep("choose");
  }

  const formAction = editing ? actions.update : actions.create;

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
          <strong>Nueva plantilla</strong>
        </div>
        {step === "choose" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="field-hint">Selecciona el tipo de plantilla.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <button
                type="button"
                className={`card cardPad ${kind === "PLAN" ? "is-active" : ""}`}
                onClick={() => setKind("PLAN")}
                style={{ textAlign: "left" }}
              >
                <strong>Plan</strong>
                <div className="field-hint">Checkout de pago / link.</div>
              </button>
              <button
                type="button"
                className={`card cardPad ${kind === "SUBSCRIPTION" ? "is-active" : ""}`}
                onClick={() => setKind("SUBSCRIPTION")}
                style={{ textAlign: "left" }}
              >
                <strong>Suscripción</strong>
                <div className="field-hint">Checkout de tokenización.</div>
              </button>
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="primary" type="button" onClick={() => setStep("form")}>
                Siguiente
              </button>
            </div>
          </div>
        ) : (
          <form action={formAction} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="kind" value={kind} />
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
              <label>Logo (URL)</label>
              <input className="input" name="logoUrl" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
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
            <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {inlineMsg("checkout_template_create", "Guardado.", "Error guardando", inlineState)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ghost" type="button" onClick={() => setStep("choose")}>
                  Atrás
                </button>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">Guardar plantilla</PendingButton>
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

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ width: "min(900px, 96vw)" }}>
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>{editing ? "Editar plantilla" : step === "choose" ? "Nueva plantilla" : "Configurar plantilla"}</h3>
              <button className="ghost" type="button" onClick={closeModal} aria-label="Cerrar">
                X
              </button>
            </div>
            <form action={actions.update} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <input type="hidden" name="kind" value={kind} />
              <div className="field">
                <label>Nombre</label>
                <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="field row">
                <label>Activa</label>
                <input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} />
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
                <label>Logo (URL)</label>
                <input className="input" name="logoUrl" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
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
              <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {inlineMsg("checkout_template_update", "Guardado.", "Error guardando", inlineState)}
                </div>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">Guardar cambios</PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
