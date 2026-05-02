import { activateSubscription, cancelSubscription, deleteSubscription, mergeDuplicateSubscriptions, resumeSubscription, suspendSubscription } from "../subscriptions/actions";
import { changeSubscriptionPlan, chargeSubscriptionNow, createCustomerFromBilling, createPlanAndSubscription, sendWhatsAppPaymentLink, sendWhatsAppTokenizationLink, updateSubscriptionTenants, updateSubscriptionBillingSettings, markSubscriptionPaidManual, unmarkSubscriptionPaidManual } from "./actions";
import { ChargeStatusModal } from "./ChargeStatusModal";
import { listSubscriptions } from "../admin/_services/subscriptions";
import { listCustomers } from "../admin/_services/customers";
import { listCatalogProducts } from "../admin/_services/products";
import { listEmpresas } from "../admin/_services/companies";
import { listTenants } from "../admin/_services/tenants";
import { getAdminSettings } from "../admin/_services/settings";
import { listCheckoutTemplates } from "../admin/_services/checkoutTemplates";
import { resolveTenantId } from "../admin/_services/tenantResolver";
import { LocalDateTime } from "../ui/LocalDateTime";
import { getCsrfToken } from "../lib/csrf";
import { type PlanOption } from "./ChangePlanButton";
import { getCivilDateAnchorUtc } from "@suscripciones/core/lib/dates";
import { SubscriptionDetailModal } from "./SubscriptionDetailModal";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { resolveSmartViewIds, parseFiltersParam } from "@suscripciones/core/services/smartViews";
import { normalizeErrorParam } from "../lib/errorParam";
import { MISSING_WHATSAPP_TEMPLATE_MESSAGE } from "../lib/notificationTemplate";
import { BillingCard } from "./BillingCard";
import { BillingHeader } from "./BillingHeader";
import { BillingViewCards } from "./BillingViewCards";
import { BillingViewKanban } from "./BillingViewKanban";
import { BillingViewLista } from "./BillingViewLista";
import { createBillingCardHelpers, buildBillingRows } from "./billingPageModel";
import type { BillingCardContext, BillingPageContentProps, BillingRow, TenantOption } from "./billingTypes";

export async function BillingPageContent({
  searchParams
}: BillingPageContentProps) {
  const renderNowDate = getCivilDateAnchorUtc(new Date());
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};

  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const checkoutUrl = typeof sp.checkoutUrl === "string" ? sp.checkoutUrl : "";
  const checkoutCustomerId = typeof sp.customerId === "string" ? sp.customerId : "";
  const tokenUrl = typeof sp.tokenUrl === "string" ? sp.tokenUrl : "";
  const chargeStatus = typeof sp.chargeStatus === "string" ? sp.chargeStatus : "";
  const chargeError = typeof sp.chargeError === "string" ? sp.chargeError : "";
  const chargeErrorDetails = typeof sp.chargeErrorDetails === "string" ? sp.chargeErrorDetails : "";
  const markPaidStatus = typeof sp.markPaidStatus === "string" ? sp.markPaidStatus : "";
  const markPaidError = typeof sp.markPaidError === "string" ? sp.markPaidError : "";
  const unmarkPaidStatus = typeof sp.unmarkPaidStatus === "string" ? sp.unmarkPaidStatus : "";
  const unmarkPaidError = typeof sp.unmarkPaidError === "string" ? sp.unmarkPaidError : "";
  const paymentId = typeof sp.paymentId === "string" ? sp.paymentId : "";
  const actionSubscriptionId = typeof sp.subscriptionId === "string" ? sp.subscriptionId : "";
  const chargeDateScheduled = typeof sp.chargeDateScheduled === "string" ? sp.chargeDateScheduled : "";
  const tenantsUpdated = typeof sp.tenantsUpdated === "string" ? sp.tenantsUpdated : "";
  const central = typeof sp.central === "string" ? sp.central : "";
  const error = typeof sp.error === "string" ? sp.error : "";
  const crear = typeof sp.crear === "string" ? sp.crear : "";
  const selectCustomerId = typeof sp.selectCustomerId === "string" ? sp.selectCustomerId : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;

  const tipo = typeof sp.tipo === "string" ? sp.tipo : "todos";
  const estado = typeof sp.estado === "string" ? sp.estado : "todos";
  const q = typeof sp.q === "string" ? sp.q : "";
  const ordenar = typeof sp.ordenar === "string" ? sp.ordenar : "vencimiento";
  const vistaRaw = typeof sp.vista === "string" ? sp.vista : "cards";
  const resolvedTenantId = tenantId ? await resolveTenantId(tenantId) : null;
  const vista = ["cards", "lista", "kanban"].includes(vistaRaw) ? vistaRaw : "cards";
  const vistaTyped = vista as "cards" | "lista" | "kanban";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const returnTo = `/billing${tenantId || q || tipo !== "todos" || estado !== "todos" || ordenar !== "vencimiento" || viewId || filters || (Number.isFinite(page) && page > 1)
    ? `?${new URLSearchParams({
        ...(tenantId ? { tenantId } : {}),
        ...(q ? { q } : {}),
        ...(tipo ? { tipo } : {}),
        ...(estado ? { estado } : {}),
        ...(ordenar ? { ordenar } : {}),
        ...(vista ? { vista } : {}),
        ...(viewId ? { viewId } : {}),
        ...(filters ? { filters } : {}),
        ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
      }).toString()}`
    : ""}`;
  const exportHref = `/api/list-csv?${new URLSearchParams({
    scope: "billing",
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(tipo ? { tipo } : {}),
    ...(estado ? { estado } : {}),
    ...(ordenar ? { ordenar } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  }).toString()}`;

  const subParams = new URLSearchParams();
  const take = vista === "kanban" ? 500 : 20;
  subParams.set("take", String(take));
  if (vista !== "kanban" && Number.isFinite(page) && page > 1) subParams.set("skip", String((Math.trunc(page) - 1) * take));
  if (q.trim()) subParams.set("q", q.trim());
  if (estado !== "todos") subParams.set("estado", estado);
  if (tipo === "suscripciones") subParams.set("collectionMode", "AUTO_DEBIT");
  if (tipo === "planes") subParams.set("collectionMode", "MANUAL_LINK");
  if (tenantId) subParams.set("tenantId", tenantId);
  const usingSmartFilters = Boolean(viewId || filters);

  let resolvedIds: string[] | null = null;
  if (viewId || filters) {
    const parsedFilters = filters ? parseFiltersParam(filters) : null;
    resolvedIds = await resolveSmartViewIds("billing", resolvedTenantId, null, viewId || undefined, parsedFilters || undefined);
  }
  const ids = usingSmartFilters && resolvedIds && resolvedIds.length === 0 ? ["__none__"] : resolvedIds || [];
  if (ids.length) subParams.set("ids", ids.join(","));

  const [subs, customers, products, empresasRes, tenantsRes, settings, notificationsConfig, checkoutTemplatesRaw] = await Promise.all([
    listSubscriptions({
      tenantId: resolvedTenantId || undefined,
      take: Number(subParams.get("take") || 50),
      skip: Number(subParams.get("skip") || 0),
      q: subParams.get("q") || "",
      estado: subParams.get("estado") || "",
      collectionMode: subParams.get("collectionMode") || "",
      customerId: subParams.get("customerId") || "",
      ids: subParams.get("ids") ? String(subParams.get("ids") || "").split(",").filter(Boolean) : []
    }),
    listCustomers({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listCatalogProducts({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listEmpresas({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listTenants(),
    getAdminSettings(),
    getNotificationsConfigForEnv("PRODUCTION").catch(() => ({ templates: [], rules: [] })),
    listCheckoutTemplates({ tenantId: resolvedTenantId || null }).catch(() => [])
  ]);

  const subItems = (subs.items ?? []) as any[];
  const total = Number(subs.total ?? 0);
  const customerItems = (customers.items ?? []) as any[];
  const productItems = (products.items ?? []) as any[];
  const empresas = (empresasRes?.items ?? []) as any[];
  const productById = new Map(productItems.map((p: any) => [String(p.id), p]));
  const tenants = (tenantsRes ?? []) as TenantOption[];
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const checkoutConfig = settings?.checkoutConfig || {};
  const notificationsTemplates = Array.isArray((notificationsConfig as any)?.templates) ? (notificationsConfig as any).templates : [];
  const notificationsRules = Array.isArray((notificationsConfig as any)?.rules) ? (notificationsConfig as any).rules : [];
  const checkoutTemplates = Array.isArray(checkoutTemplatesRaw) ? checkoutTemplatesRaw : [];
  const subscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const planBaseUrl = String(checkoutConfig?.planBaseUrl || "").trim();
  const planOptions: PlanOption[] = productItems.map((p: any): PlanOption => {
    const kind = String(p?.kind || "").toUpperCase() === "SERVICE" ? "SERVICE" : "PRODUCT";
    const requiresShipping = kind === "PRODUCT" && (p?.requiresShipping === true || p?.requiresShipping == null);
    const displayName = String(p?.name || "Producto");
    const sku = String(p?.sku || "");
    const searchText = [displayName, sku, p?.id].filter(Boolean).join(" ").toLowerCase();
    return {
      id: String(p.id),
      name: displayName,
      sku,
      searchText,
      collectionMode: String(p?.collectionMode || ""),
      priceInCents: Number(p?.basePriceInCents || p?.priceInCents || 0),
      currency: String(p?.currency || "COP"),
      kind,
      requiresShipping,
      shippingInCents: Number(p?.shippingInCents || 0)
    };
  });

  const rows = buildBillingRows({
    subItems,
    productById,
    tenantById,
    renderNowDate,
    q,
    tipo,
    estado,
    ordenar
  });

  const helperSet = createBillingCardHelpers({
    rows,
    checkoutTemplates,
    checkoutConfig,
    planBaseUrl,
    subscriptionBaseUrl,
    renderNowDate,
    actionSubscriptionId,
    checkoutCustomerId,
    checkoutUrl
  });

  const paginationBase = {
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(tipo ? { tipo } : {}),
    ...(estado ? { estado } : {}),
    ...(ordenar ? { ordenar } : {}),
    ...(vista ? { vista } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  };

  const cardContext: BillingCardContext = {
    state: {
      chargeStatus,
      chargeError,
      chargeErrorDetails,
      actionSubscriptionId,
      checkoutCustomerId,
      checkoutUrl,
      tokenUrl,
      central,
      chargeDateScheduled,
      tenantsUpdated
    },
    data: {
      tenants,
      planOptions,
      notificationsTemplates,
      notificationsRules,
      returnTo,
      csrfToken
    },
    actions: {
      chargeSubscriptionNow,
      markSubscriptionPaidManual,
      unmarkSubscriptionPaidManual,
      sendWhatsAppPaymentLink,
      sendWhatsAppTokenizationLink,
      mergeDuplicateSubscriptions,
      updateSubscriptionTenants,
      changeSubscriptionPlan,
      updateSubscriptionBillingSettings,
      deleteSubscription,
      suspendSubscription,
      cancelSubscription,
      resumeSubscription,
      activateSubscription
    },
    helpers: {
      ...helperSet
    }
  };

  const renderCard = (row: BillingRow) => <BillingCard row={row} context={cardContext} />;

  const errorMessage = (() => {
    const code = String(error || "").trim();
    if (!code) return "";
    if (code === "missing_template") return MISSING_WHATSAPP_TEMPLATE_MESSAGE;
    if (code === "empresa_no_encontrada") return "No se encontró la empresa seleccionada.";
    if (code === "empresa_sin_contacto_principal") return "La empresa no tiene contacto principal.";
    if (code === "missing_contact_or_company_or_product") return "Selecciona un contacto/empresa y un producto.";
    return normalizeErrorParam(code) || code;
  })();

  return (
    <main className="page pageWide billing-page">
      {errorMessage ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          {errorMessage}
        </div>
      ) : null}
      {markPaidStatus ? (
        <div className="card cardPad" style={{ borderColor: markPaidStatus === "ok" ? "var(--success)" : "var(--danger)" }}>
          {markPaidStatus === "ok" ? "Suscripción marcada como pagada manualmente." : `Error marcando pago manual: ${markPaidError || "unknown_error"}`}
        </div>
      ) : null}
      {unmarkPaidStatus ? (
        <div className="card cardPad" style={{ borderColor: unmarkPaidStatus === "ok" ? "var(--success)" : "var(--danger)" }}>
          {unmarkPaidStatus === "ok" ? "Pago manual desmarcado y ciclo revertido." : `Error desmarcando pago manual: ${unmarkPaidError || "unknown_error"}`}
        </div>
      ) : null}
      {chargeStatus ? (
        <ChargeStatusModal
          initialStatus={chargeStatus === "processing" ? "processing" : chargeStatus === "ok" ? "ok" : "fail"}
          paymentId={paymentId}
          chargeError={chargeError}
          chargeErrorDetails={chargeErrorDetails}
          returnTo={returnTo}
          subscriptionId={actionSubscriptionId}
          tenantId={tenantId}
          csrfToken={csrfToken}
          retryAction={chargeSubscriptionNow}
        />
      ) : null}

      <section className="settings-group">
        <BillingHeader
          filters={{
            tenantId,
            q,
            tipo,
            estado,
            ordenar,
            vista: vistaTyped,
            viewId,
            filters
          }}
          data={{
            rows,
            tenants,
            customerItems,
            empresas,
            productItems,
            csrfToken,
            returnTo,
            exportHref,
            crear,
            selectCustomerId
          }}
          actions={{
            createCustomerFromBilling,
            createPlanAndSubscription
          }}
        />

        <div className="settings-group-body">
          {vista === "cards" ? (
            <BillingViewCards rows={rows} renderCard={renderCard} />
          ) : vista === "lista" ? (
            <BillingViewLista rows={rows} context={cardContext} />
          ) : (
            <BillingViewKanban rows={rows} context={cardContext} />
          )}

          {vista === "kanban" ? null : (() => {
            const currentPage = Math.max(1, Number(page) || 1);
            const hasNext = total > 0 ? currentPage < Math.max(1, Math.ceil(total / take)) : rows.length >= take;
            const totalPages = total > 0 ? Math.max(1, Math.ceil(total / take)) : currentPage + (hasNext ? 1 : 0);
            const desktopWindow = 10;
            let start = Math.max(1, currentPage - Math.floor(desktopWindow / 2));
            let end = start + (desktopWindow - 1);
            if (end > totalPages) {
              end = totalPages;
              start = Math.max(1, end - (desktopWindow - 1));
            }
            const pages: number[] = [];
            for (let i = start; i <= end; i += 1) pages.push(i);
            const mobileWindow = 5;
            let mobileStart = Math.max(1, currentPage - 2);
            let mobileEnd = mobileStart + (mobileWindow - 1);
            if (mobileEnd > totalPages) {
              mobileEnd = totalPages;
              mobileStart = Math.max(1, mobileEnd - (mobileWindow - 1));
            }
            return (
              <div className="pagination pagination-indicator">
                {currentPage <= 1 ? (
                  <span className="page-link page-nav" aria-disabled="true">
                    Anterior
                  </span>
                ) : (
                  <a
                    className="page-link page-nav"
                    href={`/billing?${new URLSearchParams({
                      ...paginationBase,
                      page: String(Math.max(1, currentPage - 1))
                    })}`}
                  >
                    Anterior
                  </a>
                )}
                <div className="pagination-pages">
                  {pages.map((p) => (
                    <a key={p} className={`page-link${p === currentPage ? " is-active" : ""}`} href={`/billing?${new URLSearchParams({ ...paginationBase, page: String(p) })}`} aria-current={p === currentPage ? "page" : undefined}>{p}</a>
                  ))}
                </div>
                {!hasNext ? (
                  <span className="page-link page-nav" aria-disabled="true">
                    Siguiente
                  </span>
                ) : (
                  <a
                    className="page-link page-nav"
                    href={`/billing?${new URLSearchParams({
                      ...paginationBase,
                      page: String(currentPage + 1)
                    })}`}
                  >
                    Siguiente
                  </a>
                )}
              </div>
            );
          })()}
        </div>
      </section>
    </main>
  );
}
