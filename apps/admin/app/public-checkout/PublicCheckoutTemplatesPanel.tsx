"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

type Template = {
  id: string;
  name: string;
  slug: string;
  kind: "PLAN" | "SUBSCRIPTION";
  active: boolean;
  allowPlanSelect: boolean;
  requireShipping?: boolean;
  requireAddress?: boolean;
  planId?: string | null;
  branding?: any;
};

type Plan = {
  id: string;
  name: string;
  planType: "manual_link" | "auto_subscription";
  active: boolean;
};

export function PublicCheckoutTemplatesPanel({
  templates,
  plans,
  csrfToken,
  publicBaseUrl,
  inlineMsg,
  actions
}: {
  templates: Template[];
  plans: Plan[];
  csrfToken: string;
  publicBaseUrl: string;
  inlineMsg: (key: string, ok: string, fail: string) => ReactNode;
  actions: {
    create: (formData: FormData) => void;
    update: (formData: FormData) => void;
    deactivate: (formData: FormData) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [formKind, setFormKind] = useState<"PLAN" | "SUBSCRIPTION">("PLAN");

  const baseUrl = publicBaseUrl?.trim() || "";

  const activePlans = useMemo(() => plans.filter((p) => p.active), [plans]);

  function openCreate() {
    setEditing(null);
    setFormKind("PLAN");
    setOpen(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setFormKind(t.kind);
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
  }

  function buildLink(slug: string) {
    if (baseUrl) return `${baseUrl.replace(/\/$/, "")}/public/checkout/${slug}`;
    return `/public/checkout/${slug}`;
  }

  async function copyLink(slug: string) {
    const link = buildLink(slug);
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
  }

  const formAction = editing ? actions.update : actions.create;
  const formTitle = editing ? "Editar plantilla" : "Nueva plantilla";

  const availablePlans = (kind: "PLAN" | "SUBSCRIPTION") =>
    activePlans.filter((p) => (kind === "PLAN" ? p.planType === "manual_link" : p.planType === "auto_subscription"));

  const branding = (editing?.branding || {}) as any;

  useEffect(() => {
    if (!open) return;
    if (editing?.kind) setFormKind(editing.kind);
  }, [open, editing]);

  return (
    <div className="template-shell">
      <div className="template-header">
        <div>
          <h3 style={{ margin: 0 }}>Plantillas públicas</h3>
          <div className="field-hint">Cada plantilla genera su propia URL pública.</div>
        </div>
        <button className="primary" type="button" onClick={openCreate}>
          Nueva plantilla
        </button>
      </div>

      <div className="template-grid">
        {templates.map((t) => (
          <div key={t.id} className={`template-card ${t.active ? "" : "is-disabled"}`}>
            <div className="template-card-top">
              <div>
                <div className="template-title">{t.name}</div>
                <div className="field-hint">
                  {t.kind === "PLAN" ? "Plan (link de pago)" : "Suscripción (tokenización)"}
                </div>
              </div>
              <span className={`pill ${t.active ? "pill-green" : ""}`}>{t.active ? "Activa" : "Inactiva"}</span>
            </div>
            <div className="template-meta">
              <div>
                <div className="field-hint">Producto</div>
                <strong>{t.allowPlanSelect ? "Selector" : t.planId ? "Producto fijo" : "—"}</strong>
              </div>
              <div>
                <div className="field-hint">Slug</div>
                <strong>{t.slug}</strong>
              </div>
            </div>
            <div className="template-link">
              <input className="input" readOnly value={buildLink(t.slug)} />
              <button className="ghost" type="button" onClick={() => copyLink(t.slug)}>
                Copiar
              </button>
            </div>
            <div className="template-actions">
              <button className="secondary" type="button" onClick={() => openEdit(t)}>
                Editar
              </button>
              <form action={actions.deactivate}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="id" value={t.id} />
                <PendingButton className="ghost" type="submit" pendingText="Desactivando...">
                  Desactivar
                </PendingButton>
              </form>
            </div>
          </div>
        ))}
        {!templates.length ? <div className="field-hint">No hay plantillas aún.</div> : null}
      </div>

      {open ? (
        <div className="modal-backdrop" role="presentation" onClick={closeModal}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>{formTitle}</h3>
                <div className="field-hint">Personaliza el checkout público.</div>
              </div>
              <button className="ghost" type="button" onClick={closeModal}>
                Cerrar
              </button>
            </div>
            <form action={formAction} className="modal-body" style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

              <div className="field">
                <label>Nombre</label>
                <input className="input" name="name" defaultValue={editing?.name || ""} required />
              </div>
              <div className="field">
                <label>Slug (opcional)</label>
                <input className="input" name="slug" defaultValue={editing?.slug || ""} />
              </div>
              <div className="field row">
                <label>Activa</label>
                <input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} />
              </div>
              <div className="field">
                <label>Tipo</label>
                <select
                  className="select"
                  name="kind"
                  value={formKind}
                  onChange={(e) => setFormKind(e.target.value as "PLAN" | "SUBSCRIPTION")}
                >
                  <option value="PLAN">Plan con link de pago</option>
                  <option value="SUBSCRIPTION">Suscripción con tokenización</option>
                </select>
              </div>

              <div className="field row">
                <label>Selector de productos</label>
                <input type="checkbox" name="allowPlanSelect" defaultChecked={editing?.allowPlanSelect || false} />
                <span className="field-hint">Permite escoger el producto en el checkout</span>
              </div>

              <div className="field">
                <label>Producto predeterminado</label>
                <select className="select" name="planId" defaultValue={editing?.planId || ""}>
                  <option value="">Selecciona un producto</option>
                  {availablePlans(formKind).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field row">
                <label>Requiere dirección</label>
                <input type="checkbox" name="requireAddress" defaultChecked={editing?.requireAddress || false} />
              </div>
              <div className="field row">
                <label>Requiere envío</label>
                <input type="checkbox" name="requireShipping" defaultChecked={editing?.requireShipping || false} />
              </div>

              <div className="field-divider" />

              <div className="field">
                <label>Título</label>
                <input className="input" name="brandTitle" defaultValue={branding.title || ""} />
              </div>
              <div className="field">
                <label>Subtítulo</label>
                <input className="input" name="brandSubtitle" defaultValue={branding.subtitle || ""} />
              </div>
              <div className="field">
                <label>Descripción</label>
                <textarea className="input" name="brandDescription" rows={3} defaultValue={branding.description || ""} />
              </div>
              <div className="field">
                <label>Logo URL</label>
                <input className="input" name="brandLogoUrl" defaultValue={branding.logoUrl || ""} />
              </div>
              <div className="field">
                <label>Color primario</label>
                <input className="input" name="brandPrimaryColor" defaultValue={branding.primaryColor || ""} placeholder="#0f172a" />
              </div>
              <div className="field">
                <label>Fuente</label>
                <input className="input" name="brandFontFamily" defaultValue={branding.fontFamily || ""} placeholder="Manrope" />
              </div>
              <div className="field">
                <label>Email de contacto</label>
                <input className="input" name="brandContactEmail" defaultValue={branding.contactEmail || ""} placeholder="mdv.subs@apiflujos.com" />
              </div>

              <div className="field">
                <label>Título de gracias</label>
                <input className="input" name="brandSuccessTitle" defaultValue={branding.successTitle || ""} />
              </div>
              <div className="field">
                <label>Subtítulo de gracias</label>
                <input className="input" name="brandSuccessSubtitle" defaultValue={branding.successSubtitle || ""} />
              </div>
              <div className="field">
                <label>Botón de gracias</label>
                <input className="input" name="brandSuccessButtonText" defaultValue={branding.successButtonText || ""} />
              </div>
              <div className="field">
                <label>URL de redirección</label>
                <input className="input" name="brandRedirectUrl" defaultValue={branding.redirectUrl || ""} />
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {inlineMsg(editing ? "template_update" : "template_create", "Guardado.", "Error guardando")}
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
