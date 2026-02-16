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

type Product = {
  id: string;
  name: string;
  sku?: string;
  requiresShipping?: boolean;
};

type InlineState = { action: string; status: string; errorText: string };

export function PublicCheckoutTemplatesPanel({
  templates,
  plans,
  products,
  csrfToken,
  publicBaseUrl,
  inlineState,
  actions
}: {
  templates: Template[];
  plans: Plan[];
  products: Product[];
  csrfToken: string;
  publicBaseUrl: string;
  inlineState: InlineState;
  actions: {
    create: (formData: FormData) => void;
    update: (formData: FormData) => void;
    deactivate: (formData: FormData) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [formKind, setFormKind] = useState<"PLAN" | "SUBSCRIPTION">("PLAN");
  const [baseOverride, setBaseOverride] = useState("");

  const baseUrl = publicBaseUrl?.trim() || baseOverride || "";

  const activePlans = useMemo(() => plans.filter((p) => p.active), [plans]);
  const activeProducts = useMemo(() => products.filter(Boolean), [products]);
  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of activeProducts) map.set(p.id, p);
    return map;
  }, [activeProducts]);

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
  const availableProducts = activeProducts;

  useEffect(() => {
    if (!open) return;
    if (editing?.kind) setFormKind(editing.kind);
  }, [open, editing]);

  useEffect(() => {
    if (publicBaseUrl?.trim()) return;
    if (typeof window === "undefined") return;
    setBaseOverride(window.location.origin);
  }, [publicBaseUrl]);

  function inlineMsg(key: string, okText: string, failPrefix: string) {
    if (inlineState.action !== key) return null;
    if (inlineState.status === "ok") return <div className="field-hint">{okText}</div>;
    if (inlineState.status === "fail") {
      return (
        <div className="field-hint" style={{ color: "var(--danger)" }}>
          {failPrefix}: {inlineState.errorText || "unknown_error"}
        </div>
      );
    }
    return null;
  }

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
                <strong>
                  {t.allowPlanSelect
                    ? "Selector"
                    : t.planId
                      ? (t.kind === "PLAN" ? productById.get(t.planId)?.name : availablePlans(t.kind).find((p) => p.id === t.planId)?.name) || "—"
                      : "—"}
                </strong>
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
              <a className="ghost" href={buildLink(t.slug)} target="_blank" rel="noreferrer">
                Previsualizar
              </a>
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
                  {(formKind === "PLAN" ? availableProducts : availablePlans(formKind)).map((p) => (
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
              <div className="field-hint">El branding es global y se configura en los defaults.</div>

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
