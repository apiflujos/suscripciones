import Link from "next/link";
import { hasActiveCustomerPaymentSource } from "@suscripciones/core/lib/customerMetadata";
import { RowActionsMenu } from "../billing/RowActionsMenu";
import { withReturnTo } from "../lib/returnTo";
import "./customers.css";

export type CustomerListItem = {
  id: string;
  tenantId?: string | null;
  tenantName?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: any;
};

export type CustomerSubscriptionInfo = {
  hasPlan: boolean;
  productName?: string;
  status?: string;
  collectionMode?: string;
  subscriptionId?: string;
  productId?: string;
  planId?: string;
};

function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

function formatPlanLabel(rawName: unknown, skuRaw?: unknown) {
  const name = String(rawName || "").replace(/^\s*\[\d+\]\s*/, "").trim();
  if (!name) return "—";
  const sku = normalizeSku(skuRaw);
  return sku ? `SKU ${sku} · ${name}` : name;
}

function statusInfo(status: string) {
  if (status === "ACTIVE") return { label: "Activa", pill: "pill-ok" };
  if (status === "PAST_DUE") return { label: "En mora", pill: "pill-bad" };
  if (status) return { label: "Inactiva", pill: "pill-muted" };
  return { label: "", pill: "" };
}

function kindInfo(collectionMode: string) {
  if (collectionMode === "AUTO_DEBIT") return { label: "Débito automático", pill: "pill-mode-debit" };
  if (collectionMode === "AUTO_LINK" || collectionMode === "MANUAL_LINK") return { label: "Link de pago", pill: "pill-mode-link" };
  return { label: "", pill: "pill-muted" };
}

/**
 * Menú de acciones de un contacto. Todos los ítems son enlaces a páginas dedicadas
 * que conservan `returnTo` (la lista con sus filtros): ya no hay modales ni estado
 * de formularios por fila.
 */
function CustomerRowActions({
  customer,
  info,
  hasToken,
  returnTo
}: {
  customer: CustomerListItem;
  info?: CustomerSubscriptionInfo;
  hasToken: boolean;
  returnTo: string;
}) {
  const id = customer.id;
  // Con suscripción vigente se ofrecen link y débito; la página explica si falta producto o plantilla.
  const hasProduct = Boolean(info?.hasPlan);
  const item = "ghost btn-compact btn-noicon";
  return (
    <RowActionsMenu label="Acciones del contacto">
      <Link className={item} href={withReturnTo(`/customers/${id}`, returnTo)}>
        Ver ficha
      </Link>
      <Link className={item} href={withReturnTo(`/customers/${id}/edit`, returnTo)}>
        Editar contacto
      </Link>
      <Link className={item} href={withReturnTo(`/customers/${id}/new-subscription`, returnTo)}>
        Crear suscripción
      </Link>
      {hasProduct ? (
        <Link className={item} href={withReturnTo(`/customers/${id}/send/link`, returnTo)}>
          Enviar link de pago
        </Link>
      ) : null}
      {hasProduct ? (
        <Link className={item} href={withReturnTo(`/customers/${id}/send/token`, returnTo)}>
          Enviar débito automático
        </Link>
      ) : null}
      <Link className={item} href={withReturnTo(`/customers/${id}/send/catalog`, returnTo)}>
        Enviar catálogo
      </Link>
      <Link className={item} href={withReturnTo(`/customers/${id}/payment-method`, returnTo)}>
        {hasToken ? "Actualizar tarjeta" : "Guardar tarjeta"}
      </Link>
      {hasToken ? (
        <Link className={`${item} btn-red`} href={withReturnTo(`/customers/${id}/remove-token`, returnTo)}>
          Quitar token
        </Link>
      ) : null}
      <Link className={item} href={`/customers/${id}#pagos`}>
        Historial de pagos
      </Link>
      <Link className={`${item} btn-red`} href={withReturnTo(`/customers/${id}/edit`, returnTo)}>
        Eliminar
      </Link>
    </RowActionsMenu>
  );
}

export function CustomersList({
  items,
  view,
  subscriptionsByCustomer,
  returnTo
}: {
  items: CustomerListItem[];
  view: "list" | "cards";
  subscriptionsByCustomer: Record<string, CustomerSubscriptionInfo>;
  returnTo: string;
}) {
  if (view === "list") {
    return (
      <div className="contact-list customers-list" aria-label="Lista de contactos">
        <div className="contact-list-header" aria-hidden="true">
          <span>Contacto</span>
          <span>Suscripción</span>
          <span>Estado</span>
          <span>Acciones</span>
        </div>
        {items.map((c) => {
          const info = subscriptionsByCustomer[String(c.id)];
          const status = statusInfo(String(info?.status || ""));
          const kind = kindInfo(String(info?.collectionMode || ""));
          return (
            <div className="contact-list-row" key={c.id}>
              <div className="contact-list-cell" data-label="Contacto">
                <Link className="contact-list-name" href={withReturnTo(`/customers/${c.id}`, returnTo)}>
                  {c.name || c.email || c.phone || "—"}
                </Link>
                <div className="contact-list-sub">
                  {c.email || "—"} · {c.phone || "—"}
                </div>
              </div>
              <div className="contact-list-cell" data-label="Suscripción">
                <div className="contact-list-sub">{formatPlanLabel(info?.productName || "")}</div>
                <div className="contact-list-sub">{kind.label || "—"}</div>
              </div>
              <div className="contact-list-cell" data-label="Estado">
                <span className={`pill pill-sm ${status.pill || "pill-muted"}`}>{status.label || "—"}</span>
              </div>
              <div className="contact-list-cell is-actions contact-list-actions">
                <CustomerRowActions customer={c} info={info} hasToken={hasActiveCustomerPaymentSource(c.metadata)} returnTo={returnTo} />
              </div>
            </div>
          );
        })}
        {items.length === 0 ? <div className="contact-empty">Sin contactos.</div> : null}
      </div>
    );
  }

  return (
    <div className="contacts-grid" aria-label="Lista de contactos">
      {items.map((c) => {
        const info = subscriptionsByCustomer[String(c.id)];
        const hasPlan = info?.hasPlan ?? false;
        const status = statusInfo(String(info?.status || ""));
        const kind = kindInfo(String(info?.collectionMode || ""));
        const hasToken = hasActiveCustomerPaymentSource(c.metadata);
        const ident =
          c?.metadata?.identificacion || c?.metadata?.identificationNumber || c?.metadata?.documentNumber || c?.metadata?.document || "";
        return (
          <div className="billing-card" key={c.id}>
            <div className="billing-header">
              <div className="contact-head">
                <div className="contact-title">
                  <Link href={withReturnTo(`/customers/${c.id}`, returnTo)}>{c.name || "—"}</Link>
                </div>
                <div className="contact-tags">
                  {hasToken ? <span className="pill pill-ok pill-sm">Tokenizada</span> : <span className="pill pill-bad pill-sm">Sin token</span>}
                  {hasPlan && kind.label ? <span className={`pill pill-sm ${kind.pill}`}>{kind.label}</span> : <span className="pill pill-muted pill-sm">Sin suscripción</span>}
                  {status.label ? <span className={`pill ${status.pill} pill-sm`}>{status.label}</span> : null}
                </div>
              </div>
              <div className="billing-header-actions">
                <CustomerRowActions customer={c} info={info} hasToken={hasToken} returnTo={returnTo} />
              </div>
            </div>
            <div className="contact-body">
              <div className="contact-left contact-block">
                <div className="contact-block-title">Información personal</div>
                <div className="contact-person-grid">
                  <div>
                    <span>Email</span>
                    <div className="contact-value">{c.email || "—"}</div>
                  </div>
                  <div>
                    <span>Teléfono</span>
                    <div className="contact-value">{c.phone || "—"}</div>
                  </div>
                  <div>
                    <span>Canal</span>
                    <div className="contact-value">{c.tenantName || "—"}</div>
                  </div>
                  <div>
                    <span>Identificación</span>
                    <div className="contact-value">{ident || "—"}</div>
                  </div>
                </div>
              </div>
              <div className="contact-right contact-block">
                <div className="contact-block-title">Suscripción</div>
                <div className="contact-plan-grid">
                  <div>
                    <span>Plan</span>
                    <div className="contact-plan-row">
                      {hasPlan && info?.subscriptionId ? (
                        <Link href={`/billing/${info.subscriptionId}`} className="contact-value contact-value-strong customers-plan-link" title="Ir a la suscripción">
                          {formatPlanLabel(info?.productName || "")}
                        </Link>
                      ) : (
                        <span className="contact-value contact-value-strong">{hasPlan ? formatPlanLabel(info?.productName || "") : "—"}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span>Estado</span>
                    <div className="contact-plan-row">
                      <span className={`pill pill-sm ${status.pill || "pill-muted"}`}>{status.label || "—"}</span>
                    </div>
                  </div>
                  <div>
                    <span>Tipo</span>
                    <div className="contact-plan-row">
                      <span className={`pill pill-sm ${hasPlan && kind.label ? kind.pill : "pill-muted"}`}>{hasPlan && kind.label ? kind.label : "—"}</span>
                    </div>
                  </div>
                  {!hasToken ? (
                    <div className="contact-plan-hint">
                      <span className="field-hint">Envía link de débito automático para guardar tarjeta.</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {items.length === 0 ? <div className="contact-empty">Sin contactos.</div> : null}
    </div>
  );
}
