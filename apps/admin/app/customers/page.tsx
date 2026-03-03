import { createCustomer } from "./actions";
import { CustomersModals } from "./CustomersModals";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { normalizeErrorParam } from "../lib/errorParam";
import { CustomersTable } from "./CustomersTable";
import { getCsrfToken } from "../lib/csrf";
import { createPlanAndSubscription } from "../billing/actions";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { ListCsvActions } from "../ui/ListCsvActions";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchCustomers(opts?: { q?: string; take?: number; page?: number; tenantId?: string; ids?: string[] }) {
  const sp = new URLSearchParams();
  const q = String(opts?.q || "").trim();
  const take = Number(opts?.take ?? 10);
  const page = Number(opts?.page ?? 1);
  const tenantId = String(opts?.tenantId || "").trim();
  const ids = Array.isArray(opts?.ids) ? opts?.ids : [];
  if (q) sp.set("q", q);
  if (tenantId) sp.set("tenantId", tenantId);
  if (Number.isFinite(take) && take > 0) sp.set("take", String(Math.min(Math.trunc(take), 500)));
  if (Number.isFinite(page) && page > 1) sp.set("skip", String((Math.trunc(page) - 1) * Math.min(Math.trunc(take), 500)));
  if (ids.length) sp.set("ids", ids.join(","));

  const path = sp.size ? `/admin/customers?${sp.toString()}` : "/admin/customers";
  const res = await fetchAdminCached(path, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}


async function fetchPaymentLinks(q: string, tenantId?: string) {
  const sp = new URLSearchParams();
  sp.set("take", "200");
  if (q.trim()) sp.set("q", q.trim());
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/orders?${sp.toString()}`, { ttlMs: 1500 });
  const data = res.json || { items: [] as any[] };
  const items = Array.isArray(data.items) ? data.items : [];
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
  return latestByCustomer;
}

async function fetchCustomerSubscriptions(tenantId?: string) {
  const sp = new URLSearchParams();
  sp.set("take", "300");
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/subscriptions?${sp.toString()}`, { ttlMs: 1500 });
  const data = res.json || { items: [] as any[] };
  const items = Array.isArray(data.items) ? data.items : [];
  const map: Record<
    string,
    { hasPlan: boolean; planName?: string; status?: string; collectionMode?: string }
  > = {};
  for (const item of items) {
    const customerId = String(item?.customerId || item?.customer?.id || "");
    if (!customerId) continue;
    const status = String(item?.status || "");
    if (!status || status === "CANCELED") continue;
    if (map[customerId]) continue;
    const planName = String(item?.plan?.name || "");
    const collectionMode = String(item?.plan?.metadata?.collectionMode || "");
    map[customerId] = { hasPlan: true, planName, status, collectionMode };
  }
  return map;
}

async function fetchSmartLists() {
  return fetchAdminCached("/admin/comms/smart-lists?take=200", { ttlMs: 1500 });
}

async function fetchSmartListPreview(id: string, tenantId?: string) {
  if (!id) return { count: 0 };
  const tenantParam = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchAdminCached(`/admin/comms/smart-lists/${encodeURIComponent(id)}/preview${tenantParam}`, { ttlMs: 1500 });
  return res.json || { count: 0 };
}

async function fetchSmartListMembers(id: string, tenantId?: string) {
  if (!id) return { items: [] as any[] };
  const tenantParam = tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchAdminCached(`/admin/comms/smart-lists/${encodeURIComponent(id)}/members?active=1&take=200${tenantParam}`, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchCartTemplates(tenantId?: string) {
  const sp = new URLSearchParams();
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/checkout-templates?${sp.toString()}`, { ttlMs: 1500 });
  const data = res.json || { items: [] as any[] };
  const items = Array.isArray(data.items)
    ? (data.items as Array<{ id?: string; name?: string; kind?: string; active?: boolean }>)
    : [];
  return items
    .filter((t) => String(t?.kind || "") === "CART" && Boolean(t?.active))
    .map((t) => ({ id: String(t?.id || ""), name: String(t?.name || "") }))
    .filter((t) => t.id && t.name);
}

async function fetchProducts(tenantId?: string) {
  const sp = new URLSearchParams();
  sp.set("take", "300");
  if (tenantId) sp.set("tenantId", tenantId);
  const res = await fetchAdminCached(`/admin/products?${sp.toString()}`, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchSettings() {
  const res = await fetchAdminCached("/admin/settings", { ttlMs: 1500 });
  return res.json || null;
}

async function fetchCheckoutTemplates(tenantId?: string) {
  const sp = new URLSearchParams();
  if (tenantId) sp.set("tenantId", tenantId);
  else sp.set("tenantId", "all");
  const res = await fetchAdminCached(`/admin/checkout-templates?${sp.toString()}`, { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchNotificationsConfig() {
  const res = await fetchAdminCached("/admin/notifications/config", { ttlMs: 1500 });
  return res.json || { config: null };
}

async function fetchCustomerById(id: string) {
  if (!id) return null;
  const res = await fetchAdminCached(`/admin/customers/${encodeURIComponent(id)}`, { ttlMs: 1500 });
  if (!res?.ok) return null;
  return res.json?.customer || null;
}

export default async function CustomersPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main className="page">
        <div className="card cardPad">Configura `ADMIN_API_TOKEN` para consultar contactos.</div>
      </main>
    );
  }
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const txCustomerId = typeof sp.tx === "string" ? sp.tx : "";
  const listId = typeof sp.list === "string" ? sp.list : "";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const returnTo = `/customers?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(txCustomerId ? { tx: txCustomerId } : {}),
    ...(listId ? { list: listId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;
  const take = 10;
  let resolvedIds: string[] = [];
  const usingSmartFilters = Boolean(listId || viewId || filters);
  if (listId) {
    const res = await fetchSmartListMembers(listId, tenantId);
    const rows = Array.isArray(res?.items) ? res.items : [];
    resolvedIds = rows.map((row: any) => String(row?.customer?.id || row?.customerId || row?.id || "")).filter(Boolean);
  } else if (viewId) {
    const res = await fetch(`/api/smart-views/customers/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId })
    });
    const json = await res.json().catch(() => ({}));
    resolvedIds = Array.isArray(json?.ids) ? json.ids : [];
  } else if (filters) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(filters);
    } catch {
      parsed = null;
    }
    if (parsed) {
      const res = await fetch(`/api/smart-views/customers/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: parsed })
      });
      const json = await res.json().catch(() => ({}));
      resolvedIds = Array.isArray(json?.ids) ? json.ids : [];
    }
  }
  if (usingSmartFilters && resolvedIds.length === 0) {
    resolvedIds = ["__none__"];
  }

  const [data, tenantsRes, txCustomer, productsRes, templatesRes, settingsRes, notificationsRes, smartListsRes] = await Promise.all([
    fetchCustomers({ q, take, page, tenantId, ids: resolvedIds }),
    fetchAdminCached("/admin/tenants", { ttlMs: 1500 }),
    txCustomerId ? fetchCustomerById(txCustomerId) : Promise.resolve(null),
    fetchProducts(tenantId),
    fetchCheckoutTemplates(tenantId),
    fetchSettings(),
    fetchNotificationsConfig(),
    fetchSmartLists()
  ]);
  const items = (data.items ?? []) as any[];
  const total = Number.isFinite(Number((data as any)?.total)) ? Number((data as any).total) : items.length;
  if (txCustomer && !items.some((c) => String(c.id) === String(txCustomer.id))) {
    items.unshift(txCustomer);
  }
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const checkoutConfig = settingsRes?.checkoutConfig || {};
  const notificationsConfig = notificationsRes?.config || null;
  const smartListsRaw = smartListsRes?.ok ? smartListsRes.json?.items ?? [] : [];
  const smartListPreviews = smartListsRaw.length
    ? await Promise.all(smartListsRaw.map((list: any) => fetchSmartListPreview(String(list.id || ""), tenantId)))
    : [];
  const smartLists = smartListsRaw.filter((_list: any, idx: number) => {
    const preview = smartListPreviews[idx];
    return Number(preview?.count || 0) > 0;
  });
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const [latestLinks, subscriptionsByCustomer, cartTemplates] = await Promise.all([
    fetchPaymentLinks(q, tenantId),
    fetchCustomerSubscriptions(tenantId),
    fetchCartTemplates(tenantId)
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
    const pages = [];
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
        <div className="pagination-pages">
          {pages.map((p) => {
            const isDesktopOnly = p < mobileStart || p > mobileEnd;
            return (
              <a
                key={`customers-page-${p}`}
                className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                href={`/customers?${new URLSearchParams({ ...baseParams, page: String(p) })}`}
                aria-current={p === currentPage ? "page" : undefined}
              >
                {p}
              </a>
            );
          })}
        </div>
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

  const iconForCategory = (category?: string) => {
    const key = String(category || "").toLowerCase();
    if (key.includes("gam")) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l2.4 6.4L21 9l-5 4 1.8 6-5.8-3.6L6.2 19 8 13 3 9l6.6-.6z" />
        </svg>
      );
    }
    if (key.includes("rank")) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4h12v4a6 6 0 0 1-12 0V4zm3 9h6v7H9z" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 12l2 2 4-4M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
      </svg>
    );
  };

  const toneForCategory = (category?: string) => {
    const key = String(category || "").toLowerCase();
    if (key.includes("gam")) return "gamification";
    if (key.includes("rank")) return "ranking";
    if (key.includes("estado") || key.includes("status")) return "status";
    return "default";
  };

  const buildListHref = (id: string) => {
    const sp = new URLSearchParams({
      ...(q ? { q } : {}),
      ...(tenantId ? { tenantId } : {}),
      list: id
    });
    return `/customers?${sp.toString()}`;
  };
  const exportHref = `/api/list-csv?${new URLSearchParams({
    scope: "customers",
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(listId ? { list: listId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  }).toString()}`;

  return (
    <main className="page" style={{ maxWidth: "100%" }}>
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
      <section className="settings-group">
        <div className="settings-group-header">
          <div className="contacts-toolbar">
            <div className="contacts-toolbar-summary">{summaryLabel}</div>
            <CustomersModals
              customers={items}
              products={productsRes?.items ?? []}
              checkoutTemplates={templatesRes?.items ?? []}
              csrfToken={csrfToken}
              tenants={tenants}
              tenantId={tenantId}
              createCustomer={createCustomer}
              createPlanAndSubscription={createPlanAndSubscription}
              returnTo={returnTo}
              actionsClassName="contacts-toolbar-actions"
            />
          </div>
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersPanel">
                {smartLists.length ? (
                  <div className="filtersQuickRow">
                    <div className="filter-label">Listas inteligentes</div>
                    <div className="filtersQuick">
                      {smartLists.map((list: any) => (
                        <a
                          key={list.id}
                          className={`pill quick-pill ${listId === list.id ? "is-active" : ""}`}
                          href={buildListHref(list.id)}
                          data-tone={toneForCategory(list.category)}
                        >
                          <span className="quick-pill-icon" aria-hidden="true">
                            {iconForCategory(list.category)}
                          </span>
                          {list.name}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="contacts-search-row">
                  <form action="/customers" method="GET" className="filtersForm filtersSearch">
                    {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                    {listId ? <input type="hidden" name="list" value={listId} /> : null}
                    {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
                    {filters ? <input type="hidden" name="filters" value={filters} /> : null}
                    <input
                      className="input"
                      type="search"
                      name="q"
                      defaultValue={q}
                      placeholder="Buscar por nombre, email, teléfono o identificación..."
                      aria-label="Buscar contactos"
                    />
                    <button className="ghost btn-icon-only btn-filter" type="submit" aria-label="Buscar" title="Buscar" />
                  </form>
                  <SmartViewsBar
                    scope="customers"
                    initialViewId={viewId}
                    initialFilters={filters}
                    baseParams={{
                      ...(q ? { q } : {}),
                      ...(tenantId ? { tenantId } : {})
                    }}
                    compactInline
                  />
                </div>
              </div>
            </div>
            <ListCsvActions exportHref={exportHref} tenantId={tenantId} defaultEntity="customers" />
          </div>
        </div>

        <div className="settings-group-body">
          {renderPagination(total)}

          <CustomersTable
            items={items.map((c) => ({ ...c, tenantName: tenantById.get(String(c.tenantId || "")) || "—" }))}
            latestLinks={latestLinksObj}
            subscriptionsByCustomer={subscriptionsByCustomer}
            cartTemplates={cartTemplates}
            products={productsRes?.items ?? []}
            checkoutTemplates={templatesRes?.items ?? []}
            checkoutConfig={checkoutConfig}
            notificationsConfig={notificationsConfig}
            tenants={tenants}
            createCustomer={createCustomer}
            createPlanAndSubscription={createPlanAndSubscription}
            csrfToken={csrfToken}
            returnTo={returnTo}
            initialTxCustomerId={txCustomerId}
          />

          {renderPagination(total)}
        </div>
      </section>
    </main>
  );
}
