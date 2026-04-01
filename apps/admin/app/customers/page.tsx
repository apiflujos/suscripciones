import { createCustomer } from "./actions";
import { CustomersModals } from "./CustomersModals";
import { listCustomers, getCustomerById } from "../admin/_services/customers";
import { listManualOrders } from "../admin/_services/orders";
import { listSubscriptions } from "../admin/_services/subscriptions";
import { listCheckoutTemplates } from "../admin/_services/checkoutTemplates";
import { listCatalogProducts } from "../admin/_services/products";
import { listEmpresas } from "../admin/_services/companies";
import { listTenants } from "../admin/_services/tenants";
import { getAdminSettings } from "../admin/_services/settings";
import { resolveTenantId } from "../admin/_services/tenantResolver";
import { getNotificationsConfig } from "@suscripciones/core/services/notificationsConfig";
import { resolveSmartViewIds, parseFiltersParam, getSmartViewFields } from "@suscripciones/core/services/smartViews";
import { normalizeErrorParam } from "../lib/errorParam";
import { CustomersTable } from "./CustomersTable";
import { getCsrfToken } from "../lib/csrf";
import { createPlanAndSubscription } from "../billing/actions";
import { prisma } from "@suscripciones/database";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { ListCsvActions } from "../ui/ListCsvActions";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { FilterButton } from "../ui/FilterButton";
import { PageToolbar } from "../ui/PageToolbar";
import "./page-header.css";

export const dynamic = "force-dynamic";

function normalizeSku(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, "0");
}

function formatSubscriptionPlanName(plan: any) {
  const md = (plan?.metadata as any) || {};
  const displayName = String(md?.displayName || "").trim();
  const rawName = String(plan?.name || "").trim();
  const cleanName = rawName.replace(/^\s*\[\d+\]\s*/, "").trim();
  const name = displayName || cleanName || "—";
  const sku = normalizeSku(md?.sku);
  return sku ? `SKU ${sku} · ${name}` : name;
}

async function fetchCustomers(opts?: { q?: string; take?: number; page?: number; tenantId?: string; ids?: string[] }) {
  const q = String(opts?.q || "").trim();
  const take = Number(opts?.take ?? 10);
  const page = Number(opts?.page ?? 1);
  const tenantId = String(opts?.tenantId || "").trim();
  const ids = Array.isArray(opts?.ids) ? opts?.ids : [];
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * Math.min(Math.trunc(take), 500) : 0;
  return listCustomers({ q, take, skip, tenantId: tenantId || null, ids });
}


async function fetchPaymentLinks(q: string, tenantId?: string, ids?: string[]) {
  const res = await listManualOrders({ tenantId: tenantId || null, take: 200, q: q.trim() });
  const items = Array.isArray(res.items) ? res.items : [];
  const latestByCustomer = new Map<string, { checkoutUrl: string; createdAt: string; chatwootStatus: string; chatwootError?: string }>();
  for (const item of items) {
    const customerId = String(item?.customer?.id || item?.customerId || "");
    const checkoutUrl = String(item?.checkoutUrl || "");
    const createdAt = String(item?.createdAt || "");
    const chatwootStatus = String(item?.chatwootMsgs?.[0]?.status || "");
    const chatwootError = String(item?.chatwootMsgs?.[0]?.errorMessage || "");
    if (!customerId || !checkoutUrl) continue;
    const prev = latestByCustomer.get(customerId);
    if (!prev || (createdAt && createdAt > prev.createdAt)) {
      latestByCustomer.set(customerId, { checkoutUrl, createdAt, chatwootStatus, chatwootError: chatwootError || undefined });
    }
  }
  const linkWhere: any = {};
  if (tenantId) linkWhere.tenantId = tenantId;
  if (Array.isArray(ids) && ids.length) {
    linkWhere.payment = { customerId: { in: ids } };
  }
  const subscriptionLinks = await prisma.paymentLink.findMany({
    where: linkWhere,
    orderBy: { sentAt: "desc" },
    take: 300,
    select: {
      checkoutUrl: true,
      sentAt: true,
      payment: { select: { customerId: true } }
    }
  });
  for (const link of subscriptionLinks) {
    const customerId = String(link?.payment?.customerId || "");
    const checkoutUrl = String(link?.checkoutUrl || "");
    const createdAt = link?.sentAt ? new Date(link.sentAt).toISOString() : "";
    if (!customerId || !checkoutUrl) continue;
    const prev = latestByCustomer.get(customerId);
    if (!prev || (createdAt && createdAt > prev.createdAt)) {
      latestByCustomer.set(customerId, { checkoutUrl, createdAt, chatwootStatus: "", chatwootError: undefined });
    }
  }
  return latestByCustomer;
}

async function fetchCustomerSubscriptions(tenantId?: string) {
  const res = await listSubscriptions({ tenantId: tenantId || null, take: 300 });
  const items = Array.isArray(res.items) ? res.items : [];
  const map: Record<
    string,
    { hasPlan: boolean; planName?: string; status?: string; collectionMode?: string; subscriptionId?: string; productId?: string; planId?: string }
  > = {};
  for (const item of items) {
    const customerId = String(item?.customerId || item?.customer?.id || "");
    if (!customerId) continue;
    const status = String(item?.status || "");
    if (!status || status === "CANCELED") continue;
    if (map[customerId]) continue;
    const planName = formatSubscriptionPlanName(item?.plan);
    const collectionMode = String(item?.plan?.metadata?.collectionMode || "");
    const productId = String(item?.plan?.metadata?.catalog?.itemId || "");
    map[customerId] = { hasPlan: true, planName, status, collectionMode, subscriptionId: item?.id, productId, planId: item?.planId };
  }
  return map;
}

async function fetchCartTemplates(tenantId?: string) {
  const items = await listCheckoutTemplates({ tenantId: tenantId || null });
  return items
    .filter((t) => String(t?.kind || "") === "CART" && Boolean(t?.active))
    .map((t) => ({ id: String(t?.id || ""), name: String(t?.name || "") }))
    .filter((t) => t.id && t.name);
}

async function fetchProducts(tenantId?: string) {
  return listCatalogProducts({ tenantId: tenantId || null, take: 300 });
}

async function fetchSettings() {
  return getAdminSettings();
}

async function fetchCheckoutTemplates(tenantId?: string) {
  return { items: await listCheckoutTemplates({ tenantId: tenantId || null }) };
}

async function fetchNotificationsConfig() {
  const config = await getNotificationsConfig();
  return { config };
}

async function fetchCustomerById(id: string) {
  if (!id) return null;
  return getCustomerById(id);
}

export default async function CustomersPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const txCustomerId = typeof sp.tx === "string" ? sp.tx : "";
  const vistaRaw = typeof sp.vista === "string" ? sp.vista : "cards";
  const vista = ["cards", "lista"].includes(vistaRaw) ? vistaRaw : "cards";
  const vistaTyped = vista as "cards" | "lista" | "kanban";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const resolvedTenantId = tenantId ? await resolveTenantId(tenantId) : null;
  const returnTo = `/customers?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(vista ? { vista } : {}),
    ...(txCustomerId ? { tx: txCustomerId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;
  const take = 10;
  let resolvedIds: string[] = [];
  const usingSmartFilters = Boolean(viewId || filters);
  if (viewId) {
    resolvedIds = (await resolveSmartViewIds("customers", resolvedTenantId, null, viewId)) || [];
  } else if (filters) {
    const rules = parseFiltersParam(filters);
    if (rules) {
      resolvedIds = (await resolveSmartViewIds("customers", resolvedTenantId, null, undefined, rules)) || [];
    }
  }
  if (usingSmartFilters && resolvedIds.length === 0) {
    resolvedIds = ["__none__"];
  }

  const [data, tenantsRes, txCustomer, productsRes, templatesRes, empresasRes, settingsRes, notificationsRes] = await Promise.all([
    fetchCustomers({ q, take, page, tenantId: resolvedTenantId || "", ids: resolvedIds }),
    listTenants(),
    txCustomerId ? fetchCustomerById(txCustomerId) : Promise.resolve(null),
    fetchProducts(resolvedTenantId || ""),
    fetchCheckoutTemplates(resolvedTenantId || ""),
    listEmpresas({ tenantId: resolvedTenantId || "", take: 200 }),
    fetchSettings(),
    fetchNotificationsConfig()
  ]);
  const items = (data.items ?? []) as any[];
  const total = Number.isFinite(Number((data as any)?.total)) ? Number((data as any).total) : items.length;
  if (txCustomer && !items.some((c) => String(c.id) === String(txCustomer.id))) {
    items.unshift(txCustomer);
  }
  const tenants = (tenantsRes ?? []) as Array<{ id: string; name: string }>;
  const empresas = (empresasRes?.items ?? []) as any[];
  const checkoutConfig = settingsRes?.checkoutConfig || {};
  const notificationsConfig = notificationsRes?.config || null;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const [latestLinks, subscriptionsByCustomer, cartTemplates] = await Promise.all([
    fetchPaymentLinks(q, resolvedTenantId || "", items.map((c) => String(c.id))),
    fetchCustomerSubscriptions(resolvedTenantId || ""),
    fetchCartTemplates(resolvedTenantId || "")
  ]);
  const latestLinksObj = Object.fromEntries(latestLinks.entries());

  const created = typeof sp.created === "string" ? sp.created : "";
  const updated = typeof sp.updated === "string" ? sp.updated : "";
  const deleted = typeof sp.deleted === "string" ? sp.deleted : "";
  const paymentSource = typeof sp.paymentSource === "string" ? sp.paymentSource : "";
  const paymentLink = typeof sp.paymentLink === "string" ? sp.paymentLink : "";
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : undefined);

  const renderPagination = (totalCount: number) => {
    const currentPage = Math.max(1, Number(page) || 1);
    const hasNext = totalCount > 0 && currentPage < Math.max(1, Math.ceil(totalCount / take));
    const totalPages = Math.max(1, Math.ceil(totalCount / take));
    const desktopWindow = 10;
    let start = Math.max(1, currentPage - Math.floor(desktopWindow / 2));
    let end = start + desktopWindow - 1;
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
    const baseParams = {
      ...(q ? { q } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(vista ? { vista } : {}),
      ...(viewId ? { viewId } : {}),
      ...(filters ? { filters } : {})
    };
    return (
      <div className="pagination pagination-indicator">
        <a
          className="page-link page-nav"
          href={`/customers?${new URLSearchParams({
            ...baseParams,
            page: String(Math.max(1, currentPage - 1))
          })}`}
          aria-disabled={currentPage <= 1}
        >
          Anterior
        </a>
        <div className="pagination-pages" style={{ display: "none" }} />
        <a
          className="page-link page-nav"
          href={`/customers?${new URLSearchParams({
            ...baseParams,
            page: String(currentPage + 1)
          })}`}
          aria-disabled={!hasNext}
        >
          Siguiente
        </a>
      </div>
    );
  };

  const currentPage = Math.max(1, Number(page) || 1);
  const startIndex = total > 0 ? (currentPage - 1) * take + 1 : 0;
  const endIndex = items.length ? Math.min(total, startIndex + items.length - 1) : 0;
  const summaryLabel =
    items.length > 0
      ? `Mostrando ${startIndex}-${endIndex} de ${total} · ${take} por página`
      : "Sin resultados";

  const exportHref = `/api/list-csv?${new URLSearchParams({
    scope: "customers",
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  }).toString()}`;

  return (
    <main className="page customersPage" style={{ maxWidth: "100%" }}>
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Contacto creado.</div> : null}
      {updated ? <div className="card cardPad">Contacto actualizado.</div> : null}
      {deleted ? <div className="card cardPad">Contacto eliminado.</div> : null}
      {paymentSource ? <div className="card cardPad">Método de pago guardado.</div> : null}
      {paymentLink ? <div className="card cardPad">Link de pago enviado.</div> : null}

      <PageToolbar
        className="compact"
        search={(
          <form action="/customers" method="GET" className="filtersForm filtersSearch">
            {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
            {vista ? <input type="hidden" name="vista" value={vista} /> : null}
            {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
            {filters ? <input type="hidden" name="filters" value={filters} /> : null}
            <input
              className="input"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nombre, email, teléfono o identificación..."
              aria-label="Buscar contactos"
              title="Busca por nombre, email, teléfono o identificación"
            />
            <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
          </form>
        )}
        searchActions={(
          <FilterButton
            scope="customers"
            baseParams={{
              ...(q ? { q } : {}),
              ...(tenantId ? { tenantId } : {}),
              ...(viewId ? { viewId } : {}),
              ...(filters ? { filters } : {})
            }}
            initialFields={getSmartViewFields("customers")}
          />
        )}
        views={(
          <ViewModeToggles
            currentMode={vistaTyped}
            baseParams={{
              ...(q ? { q } : {}),
              ...(tenantId ? { tenantId } : {}),
              ...(viewId ? { viewId } : {}),
              ...(filters ? { filters } : {})
            }}
          />
        )}
        smartViews={(
          <SmartViewsBar
            scope="customers"
            initialViewId={viewId}
            initialFilters={filters}
            baseParams={{
              ...(q ? { q } : {}),
              ...(tenantId ? { tenantId } : {})
            }}
            initialFields={getSmartViewFields("customers")}
            compactInline
            hideFilterButton
          />
        )}
        summary={(
          <ListCsvActions exportHref={exportHref} tenantId={tenantId} defaultEntity="customers" />
        )}
      />

      <CustomersModals
        actionsClassName="customers-actions-right"
        showPlanButton={false}
        customers={items}
        empresas={empresas}
        products={productsRes?.items ?? []}
        csrfToken={csrfToken}
        tenants={tenants}
        tenantId={tenantId}
        createCustomer={createCustomer}
        createPlanAndSubscription={createPlanAndSubscription}
        returnTo={returnTo}
      />

      <div className="settings-group-body">

          <CustomersTable
            items={items.map((c) => ({ ...c, tenantName: tenantById.get(String(c.tenantId || "")) || "—" }))}
            latestLinks={latestLinksObj}
            subscriptionsByCustomer={subscriptionsByCustomer}
            cartTemplates={cartTemplates}
            products={productsRes?.items ?? []}
            empresas={empresas}
            checkoutTemplates={templatesRes?.items ?? []}
            checkoutConfig={checkoutConfig}
            notificationsConfig={notificationsConfig}
            tenants={tenants}
            createCustomer={createCustomer}
            createPlanAndSubscription={createPlanAndSubscription}
            csrfToken={csrfToken}
            returnTo={returnTo}
            initialTxCustomerId={txCustomerId}
            view={vista === "lista" ? "list" : "cards"}
          />

          {renderPagination(total)}
        </div>
    </main>
  );
}
