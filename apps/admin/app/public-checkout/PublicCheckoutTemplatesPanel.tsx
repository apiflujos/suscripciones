"use client";

import { useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PendingButton } from "../ui/PendingButton";
import { FIELD_PRESETS, FieldPreset } from "./fieldOptions";
import { PublicCheckoutDefaultsWizard } from "./PublicCheckoutDefaultsWizard";

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
  layout?: any;
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

type SectionType = "header" | "products" | "field" | "cta" | "footer";
type LayoutSection = {
  id: string;
  type: SectionType;
  enabled: boolean;
  props: Record<string, any>;
};
type Layout = { sections: LayoutSection[] };

const LOCKED_FIELD_KEYS = new Set(["firstName", "phone"]);

function SortableCanvasRow({
  section,
  onRemove,
  onToggle,
  onSelect,
  selected,
  locked
}: {
  section: LayoutSection;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  selected: boolean;
  locked: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id, disabled: locked });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const typeLabel =
    section.type === "header"
      ? "Encabezado"
      : section.type === "products"
        ? "Productos"
        : section.type === "cta"
          ? "Botón"
          : section.type === "footer"
            ? "Pie"
            : "Campo";
  const fieldLabel = section.type === "field" ? section.props?.label || section.props?.key || "Campo" : "";
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`field-row ${section.enabled ? "" : "is-disabled"} ${selected ? "is-selected" : ""}`}
      onClick={() => onSelect(section.id)}
      role="button"
      tabIndex={0}
    >
      <button type="button" className="drag-handle" {...attributes} {...listeners} disabled={locked}>
        ⋮⋮
      </button>
      <div className="field-row-body">
        <div style={{ display: "grid", gap: 2 }}>
          <strong>{typeLabel}</strong>
          {fieldLabel ? <span className="field-hint">{fieldLabel}</span> : null}
        </div>
        <div className="field-row-meta">
          {section.type === "field" ? <span className="pill">{section.props.input || "text"}</span> : null}
          {section.type === "field" ? (
            <span className="pill">{section.props.required ? "Obligatorio" : "Opcional"}</span>
          ) : null}
        </div>
      </div>
      <div className="field-row-actions">
        <button type="button" className="ghost" onClick={() => onToggle(section.id)} disabled={locked || section.type === "cta"}>
          {section.enabled ? "Ocultar" : "Mostrar"}
        </button>
        {section.type === "field" ? (
          <button type="button" className="ghost" onClick={() => onRemove(section.id)} disabled={locked}>
            Quitar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SortableProductRow({
  product,
  onRemove
}: {
  product: Product | Plan;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: product.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  return (
    <div ref={setNodeRef} style={style} className="field-row">
      <button type="button" className="drag-handle" {...attributes} {...listeners}>
        ⋮⋮
      </button>
      <div className="field-row-body">
        <div style={{ display: "grid" }}>
          <strong>{product.name}</strong>
          {"sku" in product && product.sku ? <span className="field-hint">SKU: {product.sku}</span> : null}
        </div>
      </div>
      <div className="field-row-actions">
        <button type="button" className="ghost" onClick={() => onRemove(product.id)}>
          Quitar
        </button>
      </div>
    </div>
  );
}

export function PublicCheckoutTemplatesPanel({
  templates,
  plans,
  products,
  csrfToken,
  publicBaseUrl,
  brandingDefaults,
  defaults,
  onSaveDefaults,
  autoOpen,
  inlineState,
  actions
}: {
  templates: Template[];
  plans: Plan[];
  products: Product[];
  csrfToken: string;
  publicBaseUrl: string;
  brandingDefaults?: any;
  defaults?: any;
  onSaveDefaults?: (formData: FormData) => void;
  autoOpen?: boolean;
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
  const [formError, setFormError] = useState("");
  const [layout, setLayout] = useState<Layout>({ sections: [] });
  const [baseOverride, setBaseOverride] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  const baseUrl = publicBaseUrl?.trim() || baseOverride || "";

  const activePlans = useMemo(() => plans.filter((p) => p.active), [plans]);
  const activeProducts = useMemo(() => products.filter(Boolean), [products]);
  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of activeProducts) map.set(p.id, p);
    return map;
  }, [activeProducts]);
  const planById = useMemo(() => {
    const map = new Map<string, Plan>();
    for (const p of activePlans) map.set(p.id, p);
    return map;
  }, [activePlans]);

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
    setFormError("");
    setLayout(defaultLayout());
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
    setFormError("");
    setLayout(normalizeLayout(t.layout));
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    setFormError("");
    setPreviewOpen(false);
    setSelectedSectionId(null);
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
  const selectableItems = formKind === "PLAN" ? filteredProducts : availablePlans(formKind);

  useEffect(() => {
    if (!open) return;
    if (editing?.kind) setFormKind(editing.kind);
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    if (selectedSectionId) return;
    if (layout.sections.length) setSelectedSectionId(layout.sections[0].id);
  }, [open, selectedSectionId, layout.sections.length]);

  useEffect(() => {
    if (!autoOpen) return;
    if (open) return;
    openCreate();
  }, [autoOpen, open]);

  useEffect(() => {
    if (!open) return;
    if ((inlineState.action === "template_create" || inlineState.action === "template_update") && inlineState.status === "ok") {
      closeModal();
    }
  }, [open, inlineState.action, inlineState.status]);

  useEffect(() => {
    if (!open) return;
    if (formAllowSelect) return;
    if (formPlanId) return;
    const list = formKind === "PLAN" ? filteredProducts : availablePlans(formKind);
    if (list.length) {
      setFormPlanId(list[0].id);
    }
  }, [open, formAllowSelect, formPlanId, formKind, filteredProducts, activePlans]);

  useEffect(() => {
    if (!open) return;
    if (!formPlanId) return;
    const list = formKind === "PLAN" ? activeProducts : availablePlans(formKind);
    if (!list.find((p) => p.id === formPlanId)) {
      setFormPlanId("");
    }
  }, [open, formKind, formPlanId, activeProducts, activePlans]);

  function defaultLayout(): Layout {
    return {
      sections: [
        {
          id: crypto.randomUUID(),
          type: "header",
          enabled: true,
          props: { title: "Completa tu compra", subtitle: "Escoge tu producto y paga en minutos.", description: "" }
        },
        { id: crypto.randomUUID(), type: "products", enabled: true, props: { title: "Productos", selectedIds: [] } },
        ...FIELD_PRESETS.map((preset) => ({
          id: crypto.randomUUID(),
          type: "field" as const,
          enabled: true,
          props: {
            key: preset.key,
            label: preset.label,
            input: preset.input,
            required: Boolean(preset.required),
            options: preset.options || []
          }
        })),
        { id: crypto.randomUUID(), type: "cta", enabled: true, props: {} },
        { id: crypto.randomUUID(), type: "footer", enabled: true, props: { text: "¿Dudas? Escríbenos." } }
      ]
    };
  }

  function normalizeLayout(raw: any): Layout {
    if (raw && Array.isArray(raw.sections)) {
      const hasField = raw.sections.some((s: any) => s?.type === "field");
      if (!hasField) return defaultLayout();
      const next = raw as Layout;
      const fields = next.sections.filter((s) => s.type === "field");
      const missingLocked = Array.from(LOCKED_FIELD_KEYS).filter((key) => !fields.some((f) => f.props?.key === key));
      if (missingLocked.length) {
        const lockedPresets = FIELD_PRESETS.filter((p) => missingLocked.includes(p.key)).map((preset) => ({
          id: crypto.randomUUID(),
          type: "field" as const,
          enabled: true,
          props: {
            key: preset.key,
            label: preset.label,
            input: preset.input,
            required: true,
            options: preset.options || []
          }
        }));
        const nextFields = [...lockedPresets, ...fields].map((f) =>
          LOCKED_FIELD_KEYS.has(String(f.props?.key || ""))
            ? { ...f, enabled: true, props: { ...f.props, required: true } }
            : f
        );
        const base: LayoutSection[] = [];
        const header = next.sections.find((s) => s.type === "header");
        const products = next.sections.find((s) => s.type === "products");
        const cta = next.sections.find((s) => s.type === "cta");
        const footer = next.sections.find((s) => s.type === "footer");
        if (header) base.push(header);
        if (products) base.push(products);
        base.push(...nextFields);
        if (cta) base.push(cta);
        if (footer) base.push(footer);
        return { sections: base };
      }
      const enforced = next.sections.map((s) =>
        s.type === "field" && LOCKED_FIELD_KEYS.has(String(s.props?.key || ""))
          ? { ...s, enabled: true, props: { ...s.props, required: true } }
          : s
      );
      return { sections: enforced };
    }
    return defaultLayout();
  }

  function updateSectionProps(id: string, propsPatch: Record<string, any>) {
    setLayout((prev) => ({
      sections: prev.sections.map((s) => (s.id === id ? { ...s, props: { ...s.props, ...propsPatch } } : s))
    }));
  }

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

  function validateForm() {
    if (!formName.trim()) return "El nombre es obligatorio.";
    if (!formAllowSelect && !formPlanId) return "Selecciona un producto o activa el selector.";
    if (formAllowSelect && !selectedProductIds.length) return "Selecciona al menos un producto.";
    const keys = fieldSections.filter((f) => f.enabled !== false).map((f) => String(f.props?.key || ""));
    const hasEmail = keys.includes("email");
    const hasPhone = keys.includes("phone");
    const hasName = keys.includes("firstName") || keys.includes("lastName") || keys.includes("name");
    if (!hasEmail) return "El checkout debe incluir el campo Email.";
    if (!hasPhone) return "El checkout debe incluir el campo Teléfono.";
    if (!hasName) return "El checkout debe incluir Nombre o Apellido.";
    return "";
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
  const previewList = formKind === "PLAN" ? filteredProducts : availablePlans(formKind);
  const previewCta = formKind === "PLAN" ? "Pagar" : "Guardar y pagar";
  const layoutSections = layout.sections;
  const headerSection = layoutSections.find((s) => s.type === "header") || null;
  const productsSection = layoutSections.find((s) => s.type === "products") || null;
  const footerSection = layoutSections.find((s) => s.type === "footer") || null;
  const ctaSection = layoutSections.find((s) => s.type === "cta") || null;
  const fieldSections = layoutSections.filter((s) => s.type === "field");
  const selectedSection = layoutSections.find((s) => s.id === selectedSectionId) || null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const productSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const selectedProductIds = Array.isArray(productsSection?.props?.selectedIds) ? (productsSection?.props?.selectedIds as string[]) : [];

  function onDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = layoutSections.findIndex((f) => f.id === active.id);
    const newIndex = layoutSections.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextSections = arrayMove(layoutSections, oldIndex, newIndex);
    setLayout({ sections: nextSections });
  }

  function addField(preset: FieldPreset) {
    if (fieldSections.some((f) => f.props?.key === preset.key)) return;
    const section: LayoutSection = {
      id: crypto.randomUUID(),
      type: "field",
      enabled: true,
      props: {
        key: preset.key,
        label: preset.label,
        input: preset.input,
        required: Boolean(preset.required),
        options: preset.options || []
      }
    };
    const ctaIndex = layoutSections.findIndex((s) => s.type === "cta");
    const insertAt = ctaIndex >= 0 ? ctaIndex : layoutSections.length;
    const next = [...layoutSections.slice(0, insertAt), section, ...layoutSections.slice(insertAt)];
    setLayout({ sections: next });
  }

  function updateField(id: string, patch: Record<string, any>) {
    const nextSections = layoutSections.map((f) => (f.id === id ? { ...f, props: { ...f.props, ...patch } } : f));
    setLayout({ sections: nextSections });
  }

  function toggleSection(id: string) {
    const nextSections = layoutSections.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f));
    setLayout({ sections: nextSections });
  }

  function removeField(id: string) {
    const nextSections = layoutSections.filter((f) => f.id !== id);
    setLayout({ sections: nextSections });
    if (selectedSectionId === id) {
      setSelectedSectionId(nextSections[0]?.id || null);
    }
  }

  function setSelectedProducts(nextIds: string[]) {
    if (!productsSection) return;
    updateSectionProps(productsSection.id, { selectedIds: nextIds });
  }

  function addSelectedProduct(id: string) {
    if (!productsSection) return;
    if (!formAllowSelect && selectedProductIds.length) {
      setSelectedProducts([id]);
      setFormPlanId(id);
      return;
    }
    if (selectedProductIds.includes(id)) return;
    const next = [...selectedProductIds, id];
    setSelectedProducts(next);
  }

  function removeSelectedProduct(id: string) {
    if (!productsSection) return;
    const next = selectedProductIds.filter((pid) => pid !== id);
    if (!next.length) return;
    setSelectedProducts(next);
    if (!formAllowSelect) {
      setFormPlanId(next[0] || "");
    }
  }

  function onProductDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = selectedProductIds.findIndex((f) => f === active.id);
    const newIndex = selectedProductIds.findIndex((f) => f === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(selectedProductIds, oldIndex, newIndex);
    setSelectedProducts(next);
  }

  const brandingStyle: React.CSSProperties = {
    ...(brandingDefaults?.fontFamily ? { fontFamily: brandingDefaults.fontFamily } : {}),
    ...(brandingDefaults?.primaryColor ? ({ ["--primary" as any]: brandingDefaults.primaryColor } as any) : {})
  };
  const logoUrl = brandingDefaults?.logoUrl || "";
  const previewLogo = logoUrl || "";
  const previewTitle = headerSection?.props?.title || "Completa tu compra";
  const previewSubtitle = headerSection?.props?.subtitle || "Escoge tu producto y paga en minutos.";
  const previewDescription = headerSection?.props?.description || "";
  const previewCtaLabel = ctaSection?.props?.label || previewCta;
  const selectedProducts = selectedProductIds
    .map((id) => (formKind === "PLAN" ? productById.get(id) : planById.get(id)))
    .filter(Boolean) as Array<Product | Plan>;
  const previewProducts = selectedProducts.length ? selectedProducts : previewList;

  useEffect(() => {
    if (!open) return;
    if (!productsSection) return;
    if (selectedProductIds.length) return;
    const seed = formKind === "PLAN" ? activeProducts.map((p) => p.id) : availablePlans(formKind).map((p) => p.id);
    if (!seed.length) return;
    updateSectionProps(productsSection.id, { selectedIds: seed });
  }, [open, productsSection?.id, activeProducts, selectedProductIds.length, formKind]);

  useEffect(() => {
    if (!open) return;
    if (!productsSection) return;
    const validIds = new Set(selectableItems.map((p) => p.id));
    const filtered = selectedProductIds.filter((id) => validIds.has(id));
    if (filtered.length !== selectedProductIds.length) {
      setSelectedProducts(filtered);
    }
    if (!filtered.length && selectableItems.length) {
      setSelectedProducts([selectableItems[0].id]);
    }
  }, [open, productsSection?.id, selectableItems, selectedProductIds]);

  useEffect(() => {
    if (!open) return;
    if (formAllowSelect) return;
    if (selectedProductIds.length) {
      if (selectedProductIds[0] !== formPlanId) setFormPlanId(selectedProductIds[0]);
      return;
    }
    if (formPlanId) setSelectedProducts([formPlanId]);
  }, [open, formAllowSelect, selectedProductIds, formPlanId]);

  useEffect(() => {
    if (!open) return;
    if (!productsSection) return;
    if (!formAllowSelect && selectedProductIds.length > 1) {
      const next = [selectedProductIds[0]];
      setSelectedProducts(next);
      setFormPlanId(next[0] || "");
    }
  }, [open, formAllowSelect, selectedProductIds, productsSection?.id]);

  useEffect(() => {
    if (!open) return;
    if (!productsSection) return;
    if (!formRequireAddress) {
      const nextSections = layoutSections.map((f) =>
        f.type === "field" && (f.props?.key === "address" || f.props?.key === "city" || f.props?.key === "department")
          ? { ...f, enabled: false, props: { ...f.props, required: false } }
          : f
      );
      setLayout({ sections: nextSections });
      return;
    }
    const existingKeys = new Set(
      layoutSections.filter((s) => s.type === "field").map((f) => String(f.props?.key || ""))
    );
    const addressPresets = FIELD_PRESETS.filter((p) => ["address", "city", "department"].includes(p.key));
    const missing = addressPresets.filter((p) => !existingKeys.has(p.key));
    const appended = missing.map((preset) => ({
      id: crypto.randomUUID(),
      type: "field" as const,
      enabled: true,
      props: {
        key: preset.key,
        label: preset.label,
        input: preset.input,
        required: true,
        options: preset.options || []
      }
    }));
    const ctaIndex = layoutSections.findIndex((s) => s.type === "cta");
    const insertAt = ctaIndex >= 0 ? ctaIndex : layoutSections.length;
    const withAppended = missing.length
      ? [...layoutSections.slice(0, insertAt), ...appended, ...layoutSections.slice(insertAt)]
      : layoutSections;
    const combined = withAppended.map((f) =>
      f.type === "field" && (f.props?.key === "address" || f.props?.key === "city" || f.props?.key === "department")
        ? { ...f, enabled: true, props: { ...f.props, required: true } }
        : f
    );
    setLayout({ sections: combined });
  }, [open, formRequireAddress]);

  return (
    <div className="template-shell">
      <div className="panel module checkout-panel">
        <div className="panelHeaderRow" style={{ marginBottom: 10 }}>
          <div>
            <strong>Checkout público</strong>
            <div className="field-hint">Configura marca, dominio y plantillas en un solo lugar.</div>
          </div>
          <button className="primary" type="button" onClick={openCreate}>
            Nueva plantilla
          </button>
        </div>
        <div className="checkout-panel-grid">
          {defaults && onSaveDefaults ? (
            <div className="checkout-section">
              <div className="section-label">Marca y dominio</div>
              <PublicCheckoutDefaultsWizard defaults={defaults} csrfToken={csrfToken} onSave={onSaveDefaults} />
              <div style={{ marginTop: 8 }}>
                {inlineState.action === "public_defaults" && inlineState.status === "ok" ? (
                  <div className="authAlert">Configuración guardada.</div>
                ) : null}
                {inlineState.action === "public_defaults" && inlineState.status === "fail" ? (
                  <div className="authAlert is-danger">Error guardando: {inlineState.errorText || "unknown_error"}</div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="checkout-section">
            <div className="section-label">Plantillas</div>
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
          </div>
        </div>
      </div>

      {open ? (
        <div className="template-inline-builder">
          <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{formTitle}</strong>
              <div className="field-hint">Configura y guarda.</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ghost" type="button" onClick={() => setPreviewOpen(true)}>
                Preview
              </button>
              <button className="ghost" type="button" onClick={closeModal}>
                Cerrar
              </button>
            </div>
          </div>

          <form
            action={formAction}
            className="template-modal-body"
            style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr" }}
            onSubmit={(e) => {
              const err = validateForm();
              if (err) {
                e.preventDefault();
                setFormError(err);
                return;
              }
              setFormError("");
            }}
          >
            <input type="hidden" name="layout" value={JSON.stringify(layout)} />
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="planId" value={formPlanId} />
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

            <div>
              <div className="builder-group">
                <div className="builder-group-title">1. Datos de la plantilla</div>
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
              </div>

              <div className="builder-group">
                <div className="builder-group-title">2. Canvas</div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={layoutSections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="field-list">
                      {layoutSections.map((section) => (
                        <SortableCanvasRow
                          key={section.id}
                          section={section}
                          selected={selectedSectionId === section.id}
                          onSelect={setSelectedSectionId}
                          onRemove={removeField}
                          onToggle={toggleSection}
                          locked={section.type === "field" && LOCKED_FIELD_KEYS.has(String(section.props?.key || ""))}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <div className="field">
                  <label>Agregar campo</label>
                  <div className="field-add">
                    {FIELD_PRESETS.map((p) => (
                      <button key={p.key} type="button" className="ghost" onClick={() => addField(p)}>
                        + {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="builder-group">
                <div className="builder-group-title">3. Editor de bloque</div>
                {!selectedSection ? <div className="field-hint">Selecciona un bloque del canvas.</div> : null}

                {selectedSection?.type === "header" ? (
                  <>
                    <div className="field">
                      <label>Título (checkout)</label>
                      <input
                        className="input"
                        value={previewTitle}
                        onChange={(e) => updateSectionProps(selectedSection.id, { title: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Subtítulo</label>
                      <input
                        className="input"
                        value={previewSubtitle}
                        onChange={(e) => updateSectionProps(selectedSection.id, { subtitle: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Descripción</label>
                      <input
                        className="input"
                        value={previewDescription}
                        onChange={(e) => updateSectionProps(selectedSection.id, { description: e.target.value })}
                        placeholder="Añade un texto corto."
                      />
                    </div>
                    <div className="field-hint">El branding general (logo, color, fuente) se define en la configuración base.</div>
                  </>
                ) : null}

                {selectedSection?.type === "products" ? (
                  <>
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
                      <label>Productos en el checkout</label>
                      {formAllowSelect ? <div className="field-hint">El cliente verá un selector de productos.</div> : null}
                      {!formAllowSelect && !formPlanId ? (
                        <div className="field-hint" style={{ color: "var(--danger)" }}>
                          Debes seleccionar un producto o activar el selector.
                        </div>
                      ) : null}
                      <DndContext sensors={productSensors} collisionDetection={closestCenter} onDragEnd={onProductDragEnd}>
                        <SortableContext items={selectedProductIds} strategy={verticalListSortingStrategy}>
                          <div className="field-list">
                            {selectedProducts.map((p) => (
                              <SortableProductRow key={p.id} product={p} onRemove={removeSelectedProduct} />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                      {!selectedProducts.length ? <div className="field-hint">No hay productos seleccionados.</div> : null}
                      <div className="field" style={{ marginTop: 10 }}>
                        <label>Agregar producto</label>
                        <div className="field-add">
                          {selectableItems.map((p) => {
                            const disabled = !formAllowSelect && selectedProductIds.length >= 1 && !selectedProductIds.includes(p.id);
                            return (
                              <button key={p.id} type="button" className="ghost" onClick={() => addSelectedProduct(p.id)} disabled={disabled}>
                                + {p.name}
                              </button>
                            );
                          })}
                        </div>
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
                  </>
                ) : null}

                {selectedSection?.type === "field" ? (
                  <>
                    <div className="field">
                      <label>Etiqueta</label>
                      <input
                        className="input"
                        value={selectedSection.props?.label || ""}
                        onChange={(e) => updateField(selectedSection.id, { label: e.target.value })}
                        disabled={LOCKED_FIELD_KEYS.has(String(selectedSection.props?.key || ""))}
                      />
                    </div>
                    <div className="field row">
                      <label>Requerido</label>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedSection.props?.required)}
                        onChange={(e) => updateField(selectedSection.id, { required: e.target.checked })}
                        disabled={LOCKED_FIELD_KEYS.has(String(selectedSection.props?.key || ""))}
                      />
                    </div>
                    <div className="field-hint">El tipo de campo se define por el preset.</div>
                  </>
                ) : null}

                {selectedSection?.type === "cta" ? (
                  <div className="field">
                    <label>Texto botón</label>
                    <input
                      className="input"
                      value={selectedSection.props?.label || ""}
                      onChange={(e) => updateSectionProps(selectedSection.id, { label: e.target.value })}
                      placeholder={previewCta}
                    />
                  </div>
                ) : null}

                {selectedSection?.type === "footer" ? (
                  <div className="field">
                    <label>Texto de ayuda</label>
                    <input
                      className="input"
                      value={selectedSection.props?.text || ""}
                      onChange={(e) => updateSectionProps(selectedSection.id, { text: e.target.value })}
                      placeholder="¿Dudas? Escríbenos."
                    />
                  </div>
                ) : null}
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  {formError ? <div className="field-hint" style={{ color: "var(--danger)" }}>{formError}</div> : null}
                  {inlineMsg(editing ? "template_update" : "template_create", "Guardado.", "Error guardando")}
                </div>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar
                </PendingButton>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {open && previewOpen ? (
        <div
          className="preview-modal"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,10,10,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999
          }}
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="template-preview template-builder"
            style={{ ...brandingStyle, width: "min(980px, 92vw)", maxHeight: "88vh", overflow: "auto", background: "var(--panel, #fff)", borderRadius: 16, padding: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panelHeaderRow" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <strong>Preview</strong>
              <button className="ghost" type="button" onClick={() => setPreviewOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="preview-grid">
              {[{ label: "Desktop", maxProducts: 3, extraClass: "" }, { label: "Mobile", maxProducts: 2, extraClass: "preview-mobile" }].map((cfg) => (
                <div key={cfg.label} className={`preview-card ${cfg.extraClass}`}>
                  <div className="preview-device">{cfg.label}</div>
                  {previewLogo ? <img src={previewLogo} alt="Logo" className="logo-preview" /> : null}
                  {layoutSections.map((section) => {
                    if (section.enabled === false) return null;
                    if (section.type === "header") {
                      return (
                        <div key={section.id}>
                          <div className="canvas-title">{previewTitle}</div>
                          <div className="canvas-subtitle">{previewSubtitle}</div>
                          {previewDescription ? <div className="canvas-muted">{previewDescription}</div> : null}
                        </div>
                      );
                    }
                    if (section.type === "products") {
                      return (
                        <div key={section.id} className="canvas-products">
                          {(previewProducts || []).slice(0, cfg.maxProducts).map((p) => (
                            <div key={p.id} className="canvas-product-card">
                              {"imageUrl" in p && p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <div className="canvas-thumb">📦</div>}
                              <div className="canvas-product-name">{p.name}</div>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    if (section.type === "field") {
                      return (
                        <div key={section.id} className="canvas-input">
                          <span>{section.props?.label}</span>
                        </div>
                      );
                    }
                    if (section.type === "cta") {
                      return (
                        <button key={section.id} type="button" className="canvas-cta">
                          {previewCtaLabel}
                        </button>
                      );
                    }
                    if (section.type === "footer") {
                      return (
                        <div key={section.id} className="canvas-muted">
                          {footerSection?.props?.text || ""}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
