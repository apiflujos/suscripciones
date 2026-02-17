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

  function openCreate() {
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
    setOpen(true);
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
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
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
        <button className="primary" type="button" onClick={openCreate}>
          Crear nuevo
        </button>
      </div>

      {!templates.length ? <div className="field-hint">Aún no hay plantillas.</div> : null}
      <div className="template-grid">
        {templates.map((t) => (
          <div key={t.id} className={`template-card ${t.active ? "" : "is-disabled"}`}>
            <div className="template-card-top">
              <div>
                <div className="template-title">{t.name}</div>
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
        <div className="panel module" style={{ marginTop: 16 }}>
          <div className="panelHeaderRow" style={{ justifyContent: "space-between" }}>
            <strong>{editing ? "Editar plantilla" : "Nueva plantilla"}</strong>
            <button className="ghost" type="button" onClick={closeModal}>
              Cerrar
            </button>
          </div>
          <form action={formAction} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div className="field">
              <label>Nombre</label>
              <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Tipo</label>
              <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                <option value="PLAN">Plan</option>
                <option value="SUBSCRIPTION">Suscripción</option>
              </select>
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
              <input className="input" name="publicTitle" value={publicTitle} onChange={(e) => setPublicTitle(e.target.value)} placeholder="Paga tu plan" />
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
                {inlineMsg(editing ? "checkout_template_update" : "checkout_template_create")}
              </div>
              <PendingButton className="primary" type="submit" pendingText="Guardando...">Guardar</PendingButton>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
