import Link from "next/link";
import { PendingButton } from "../ui/PendingButton";
import { RowActionsMenu } from "../billing/RowActionsMenu";
import { withReturnTo } from "../lib/returnTo";
import { checkoutTemplateErrorMessage, checkoutTemplateKindLabel, type TemplateProduct, type TemplateTenant } from "./templateErrors";
import "./checkout-templates.css";

type Template = {
  id: string;
  name: string;
  kind: "PLAN" | "SUBSCRIPTION" | "CART";
  active: boolean;
  productIds?: any;
  expiryHours?: number | null;
  logoUrl?: string | null;
};

const DEFAULT_RETURN_TO = "/settings?tab=checkout-publico";

/**
 * Lista de plantillas de checkout y plantillas predeterminadas.
 *
 * Solo lista: crear y editar viven en /checkout-templates/new y /checkout-templates/[id]
 * (antes un asistente dentro de un modal de 900 px). Cada fila trae su menú de acciones
 * con enlaces y formularios de una sola acción.
 *
 * `returnTo` es la URL de la lista que lo muestra (Ajustes o /checkout-templates); a ella
 * vuelven las páginas de formulario.
 */
export function CheckoutTemplatesPanel({
  templates,
  products,
  csrfToken,
  inlineState,
  initialKind = "",
  initialStep = "choose",
  checkoutDefaults,
  actions,
  returnTo = DEFAULT_RETURN_TO
}: {
  templates: Template[];
  products: TemplateProduct[];
  /** Se mantiene por compatibilidad con Ajustes; el canal se elige en el formulario. */
  tenants?: TemplateTenant[];
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
    create?: (formData: FormData) => void;
    update?: (formData: FormData) => void;
    remove?: (formData: FormData) => void;
    duplicate: (formData: FormData) => void;
    defaults?: (formData: FormData) => void;
    saveDefaults: (formData: FormData) => void;
  };
  returnTo?: string;
}) {
  const productById = new Map<string, TemplateProduct>();
  products.forEach((p) => productById.set(String(p.id), p));

  const newHref = withReturnTo(
    `/checkout-templates/new${initialKind && initialStep === "form" ? `?kind=${initialKind}` : ""}`,
    returnTo
  );

  const productLabel = (t: Template) => {
    const first = (Array.isArray(t.productIds) ? t.productIds : [])[0];
    if (first == null) return "—";
    if (typeof first === "string") return productById.get(first)?.name || "—";
    const id = String(first?.id || "");
    const mode = String(first?.mode || "AUTO_LINK").toUpperCase() === "AUTO_DEBIT" ? "Débito automático" : "Link de pago";
    const total = (t.productIds as any[]).length;
    const name = productById.get(id)?.name || "—";
    return `${name}${t.kind === "CART" ? ` (${mode})` : ""}${total > 1 ? ` +${total - 1}` : ""}`;
  };

  const { action, status, errorText } = inlineState;
  const resultNotice = (() => {
    if (!action.startsWith("checkout_template_") && action !== "checkout_defaults") return null;
    if (status === "ok") {
      const text =
        action === "checkout_defaults"
          ? "Predeterminadas guardadas."
          : action === "checkout_template_delete"
            ? "Plantilla eliminada."
            : action === "checkout_template_duplicate"
              ? "Plantilla duplicada."
              : "Plantilla guardada.";
      return <div className="field-hint is-success" role="status">{text}</div>;
    }
    if (status === "fail") {
      return (
        <div className="field-hint ct-error" role="alert">
          {action === "checkout_defaults" ? "Error al guardar las predeterminadas." : checkoutTemplateErrorMessage(errorText)}
        </div>
      );
    }
    return null;
  })();

  const defaultSelect = (label: string, name: string, kind: Template["kind"], current?: string) => (
    <label>
      <span className="field-label">{label}</span>
      <select name={name} className="select" defaultValue={current || ""}>
        <option value="">— Sin predeterminada —</option>
        {templates
          .filter((t) => t.kind === kind && t.active)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <div className="panel module">
      <div className="panelHeaderRow checkout-templates-header">
        <div className="checkout-templates-header-copy">
          <h2 style={{ margin: 0, fontSize: 15 }}>Plantillas</h2>
          <div className="field-hint">Paso 1: crea plantillas. Paso 2: define predeterminadas abajo.</div>
        </div>
        <div className="checkout-templates-header-actions">
          <Link className="primary btn-compact btn-create" href={newHref} data-loader="off">
            Nueva plantilla
          </Link>
        </div>
      </div>
      {resultNotice}

      {!templates.length ? (
        <div className="field-hint ct-empty">Aún no hay plantillas. Crea una para poder asignarla como predeterminada.</div>
      ) : (
        <div className="ct-list" role="table" aria-label="Plantillas de checkout">
          <div className="ct-list-head" role="row">
            <span role="columnheader">Nombre</span>
            <span role="columnheader">Tipo</span>
            <span role="columnheader">Producto</span>
            <span role="columnheader">Expira</span>
            <span role="columnheader">Estado</span>
            <span role="columnheader">
              <span className="sr-only">Acciones</span>
            </span>
          </div>
          {templates.map((t) => {
            const editHref = withReturnTo(`/checkout-templates/${encodeURIComponent(t.id)}`, returnTo);
            const deleteHref = withReturnTo(`/checkout-templates/${encodeURIComponent(t.id)}?confirmDelete=1`, returnTo);
            return (
              <div key={t.id} className={`ct-row ${t.active ? "" : "is-disabled"}`} role="row">
                <div className="ct-cell ct-name" data-area="name" role="cell">
                  {t.logoUrl ? <img src={t.logoUrl} alt="" className="ct-logo" /> : null}
                  <Link href={editHref} data-loader="off">{t.name}</Link>
                </div>
                <div className="ct-cell" data-area="kind" data-label="Tipo" role="cell">{checkoutTemplateKindLabel(t.kind)}</div>
                <div className="ct-cell" data-area="product" data-label="Producto" role="cell">{productLabel(t)}</div>
                <div className="ct-cell" data-area="expiry" data-label="Expira" role="cell">{t.expiryHours ? `${t.expiryHours}h` : "Nunca"}</div>
                <div className="ct-cell" data-area="status" role="cell">
                  <span className={`pill ${t.active ? "pill-green" : ""}`}>{t.active ? "Activa" : "Inactiva"}</span>
                </div>
                <div className="ct-actions" role="cell">
                  <RowActionsMenu label={`Acciones de la plantilla ${t.name}`}>
                    <Link className="ghost btn-compact btn-noicon" href={editHref} data-loader="off">Editar</Link>
                    <form action={actions.duplicate}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <PendingButton className="ghost btn-compact btn-noicon" type="submit" pendingText="Duplicando...">
                        Duplicar
                      </PendingButton>
                    </form>
                    <Link className="ghost btn-compact btn-red btn-noicon" href={deleteHref} data-loader="off">Eliminar…</Link>
                  </RowActionsMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: "1px dashed var(--stroke)", marginTop: 16, paddingTop: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-sm)" }}>Predeterminadas</h3>
          <div className="field-hint">Plantilla usada cuando no hay una asignada al producto específico.</div>
        </div>
        <form action={actions.saveDefaults} className="ct-defaults-form">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="ct-defaults-grid">
            {defaultSelect("Link de pago (PLAN)", "defaultPlanTemplateId", "PLAN", checkoutDefaults?.defaultPlanTemplateId)}
            {defaultSelect("Débito automático (SUBSCRIPTION)", "defaultSubscriptionTemplateId", "SUBSCRIPTION", checkoutDefaults?.defaultSubscriptionTemplateId)}
            {defaultSelect("Catálogo (CART)", "defaultCartTemplateId", "CART", checkoutDefaults?.defaultCartTemplateId)}
          </div>
          <div>
            <PendingButton className="primary btn-compact" type="submit" pendingText="Guardando...">
              Guardar predeterminadas
            </PendingButton>
          </div>
        </form>
      </div>
    </div>
  );
}
