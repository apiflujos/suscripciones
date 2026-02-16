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
  imageUrl?: string | null;
  basePriceInCents?: number;
  currency?: string;
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
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formAllowSelect, setFormAllowSelect] = useState(false);
  const [formPlanId, setFormPlanId] = useState("");
  const [formRequireShipping, setFormRequireShipping] = useState(false);
  const [formRequireAddress, setFormRequireAddress] = useState(false);
  const [productSearch, setProductSearch] = useState("");
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
    setFormName("");
    setFormSlug("");
    setFormAllowSelect(false);
    setFormPlanId("");
    setFormRequireShipping(false);
    setFormRequireAddress(false);
    setProductSearch("");
    setOpen(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setFormKind(t.kind);
    setFormName(t.name || "");
    setFormSlug(t.slug || "");
    setFormAllowSelect(Boolean(t.allowPlanSelect));
    setFormPlanId(t.planId || "");
    setFormRequireShipping(Boolean(t.requireShipping));
    setFormRequireAddress(Boolean(t.requireAddress));
    setProductSearch("");
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
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return availableProducts;
    const q = productSearch.toLowerCase();
    return availableProducts.filter((p) => `${p.name} ${p.sku || ""}`.toLowerCase().includes(q));
  }, [availableProducts, productSearch]);

  useEffect(() => {
    if (!open) return;
    if (editing?.kind) setFormKind(editing.kind);
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    if ((inlineState.action === "template_create" || inlineState.action === "template_update") && inlineState.status === "ok") {
      closeModal();
    }
  }, [open, inlineState.action, inlineState.status]);

  useEffect(() => {
    if (!open) return;
    if (!formPlanId) return;
    const list = formKind === "PLAN" ? activeProducts : availablePlans(formKind);
    if (!list.find((p) => p.id === formPlanId)) {
      setFormPlanId("");
    }
  }, [open, formKind, formPlanId, activeProducts, activePlans]);

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

  function formatCopFromCents(cents: number) {
    const pesos = Math.trunc(Number(cents || 0) / 100);
    if (!Number.isFinite(pesos)) return "";
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos);
  }

  function slugify(input: string) {
    return String(input || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
  }

  const effectiveSlug = formSlug.trim() || slugify(formName);
  const previewLink = effectiveSlug ? buildLink(effectiveSlug) : "";
  const previewProduct =
    formKind === "PLAN"
      ? productById.get(formPlanId || "")?.name || ""
      : availablePlans(formKind).find((p) => p.id === formPlanId)?.name || "";
  const previewList = formKind === "PLAN" ? filteredProducts : availablePlans(formKind);
  const previewCta = formKind === "PLAN" ? "Pagar" : "Guardar y pagar";

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
            <form action={formAction} className="modal-body template-modal-body">
              <input type="hidden" name="csrf" value={csrfToken} />
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

              <div className="template-modal-left">
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" value={formName} onChange={(e) => setFormName(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Slug (opcional)</label>
                  <input className="input" name="slug" value={formSlug} onChange={(e) => setFormSlug(e.target.value)} />
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
                  <input
                    type="checkbox"
                    name="allowPlanSelect"
                    checked={formAllowSelect}
                    onChange={(e) => setFormAllowSelect(e.target.checked)}
                  />
                  <span className="field-hint">Permite escoger el producto en el checkout</span>
                </div>

                <div className="field">
                  <label>Buscar producto</label>
                  <input
                    className="input"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Buscar por nombre o SKU..."
                  />
                </div>

                <div className="field">
                  <label>Producto predeterminado</label>
                  <input type="hidden" name="planId" value={formPlanId} />
                  {formAllowSelect ? <div className="field-hint">Se mostrará un selector en el checkout.</div> : null}
                  {!formAllowSelect && !formPlanId ? (
                    <div className="field-hint" style={{ color: "var(--danger)" }}>
                      Debes seleccionar un producto o activar el selector.
                    </div>
                  ) : null}
                  <div className={`product-pick ${formAllowSelect ? "is-disabled" : ""}`} aria-disabled={formAllowSelect}>
                    {(formKind === "PLAN" ? filteredProducts : availablePlans(formKind)).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`product-option ${formPlanId === p.id ? "is-active" : ""}`}
                        onClick={() => setFormPlanId(p.id)}
                        disabled={formAllowSelect}
                        title={p.name}
                      >
                        <div className="product-card-row">
                          {"imageUrl" in p && p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} className="product-thumb" />
                          ) : (
                            <div className="product-thumb product-thumb-fallback">📦</div>
                          )}
                          <div className="product-card-text">
                            <div className="product-title">{p.name}</div>
                            {"sku" in p && p.sku ? <div className="field-hint">SKU: {p.sku}</div> : null}
                            {"basePriceInCents" in p && typeof p.basePriceInCents === "number" ? (
                              <div className="field-hint">{formatCopFromCents(p.basePriceInCents)}</div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    ))}
                    {!(formKind === "PLAN" ? filteredProducts : availablePlans(formKind)).length ? (
                      <div className="field-hint">No hay productos con ese filtro.</div>
                    ) : null}
                  </div>
                </div>

                <div className="field row">
                  <label>Requiere dirección</label>
                  <input
                    type="checkbox"
                    name="requireAddress"
                    checked={formRequireAddress}
                    onChange={(e) => setFormRequireAddress(e.target.checked)}
                  />
                </div>
                <div className="field row">
                  <label>Requiere envío</label>
                  <input
                    type="checkbox"
                    name="requireShipping"
                    checked={formRequireShipping}
                    onChange={(e) => setFormRequireShipping(e.target.checked)}
                  />
                </div>

                <div className="field-divider" />
                <div className="field-hint">El branding es global y se configura en los defaults.</div>

                <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {inlineMsg(editing ? "template_update" : "template_create", "Guardado.", "Error guardando")}
                  <PendingButton className="primary" type="submit" pendingText="Guardando...">
                    Guardar
                  </PendingButton>
                </div>
              </div>

              <aside className="template-preview">
                <div className="preview-badge">Preview</div>
                <div className="preview-title">{formName || "Nombre de la plantilla"}</div>
                <div className="preview-subtitle">
                  {formKind === "PLAN" ? "Plan (link de pago)" : "Suscripción (tokenización)"}
                </div>
                {previewLink ? <div className="preview-link">{previewLink}</div> : null}
                <div className="preview-list">
                  <div><strong>Producto</strong>: {formAllowSelect ? "Selector" : previewProduct || "—"}</div>
                  <div><strong>Dirección</strong>: {formRequireAddress ? "Sí" : "No"}</div>
                  <div><strong>Envío</strong>: {formRequireShipping ? "Sí" : "No"}</div>
                </div>
                {formAllowSelect ? (
                  <div className="preview-products">
                    {(previewList || []).slice(0, 3).map((p) => (
                      <span key={p.id} className="pill">{p.name}</span>
                    ))}
                    {previewList.length > 3 ? <span className="pill">+{previewList.length - 3} más</span> : null}
                  </div>
                ) : null}
                <div className="preview-cta">{previewCta}</div>
              </aside>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
