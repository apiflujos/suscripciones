import { createProduct, deleteProduct } from "./actions";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { ProductsTable } from "./ProductsTable";
import { getCsrfToken } from "../lib/csrf";
import { createTenant } from "../tenants/actions";
import { ProductsModals } from "./ProductsModals";
import { createCustomerFromBilling, createPlanAndSubscription } from "../billing/actions";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchAdmin(path: string) {
  return fetchAdminCached(path, { ttlMs: 1500 });
}

async function fetchSmartLists() {
  const res = await fetchAdminCached("/admin/comms/smart-lists?take=200", { ttlMs: 1500 });
  return res.json || { items: [] as any[] };
}

async function fetchSmartListMembers(id: string, tenantId?: string) {
  if (!id) return { items: [] as any[] };
  const tenantParam = tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchAdminCached(
    `/admin/comms/smart-lists/${encodeURIComponent(id)}/members?active=1&take=200${tenantParam}`,
    { ttlMs: 1500 }
  );
  return res.json || { items: [] as any[] };
}

async function fetchChatwootInboxes() {
  try {
    const res = await fetchAdminCached("/admin/chatwoot/inboxes", { ttlMs: 1500 });
    return res.json || { items: [] as any[] };
  } catch {
    return { items: [] as any[] };
  }
}

export default async function ProductsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const { token } = getConfig();
  if (!token) {
    return (
      <main className="page pageWide">
        <p>Configura `ADMIN_API_TOKEN` en el Admin para poder consultar el API.</p>
      </main>
    );
  }

  const spParams = (await searchParams) ?? {};
  const created = typeof spParams.created === "string" ? spParams.created : "";
  const contactCreated = typeof spParams.contactCreated === "string" ? spParams.contactCreated : "";
  const updated = typeof spParams.updated === "string" ? spParams.updated : "";
  const deleted = typeof spParams.deleted === "string" ? spParams.deleted : "";
  const tenantId = typeof spParams.tenantId === "string" ? spParams.tenantId : "";
  const tenantCreated = typeof spParams.tenantCreated === "string" ? spParams.tenantCreated : "";
  const error = typeof spParams.error === "string" ? spParams.error : "";
  const sent = typeof spParams.sent === "string" ? spParams.sent : "";
  const q = typeof spParams.q === "string" ? spParams.q : "";
  const page = typeof spParams.page === "string" ? Number(spParams.page) : 1;
  const viewId = typeof spParams.viewId === "string" ? spParams.viewId : "";
  const filters = typeof spParams.filters === "string" ? spParams.filters : "";
  const returnTo = `/products?${new URLSearchParams({
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;

  const sp = new URLSearchParams();
  if (tenantId) sp.set("tenantId", tenantId);
  if (q.trim()) sp.set("q", q.trim());
  const take = 20;
  sp.set("take", String(take));
  if (Number.isFinite(page) && page > 1) sp.set("skip", String((Math.trunc(page) - 1) * take));
  let resolvedIds: string[] = [];
  const usingSmartFilters = Boolean(viewId || filters);
  if (viewId) {
    const res = await fetch(`/api/smart-views/products/resolve`, {
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
      const res = await fetch(`/api/smart-views/products/resolve`, {
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

  if (resolvedIds.length) sp.set("ids", resolvedIds.join(","));

  const [products, tenantsRes, customersRes, templatesRes, chatwootInboxesRes] = await Promise.all([
    fetchAdmin(`/admin/products?${sp.toString()}`),
    fetchAdminCached("/admin/tenants", { ttlMs: 1500 }),
    fetchAdminCached(tenantId ? `/admin/customers?take=200&tenantId=${encodeURIComponent(tenantId)}` : "/admin/customers?take=200", { ttlMs: 1500 }),
    fetchAdminCached(tenantId ? `/admin/checkout-templates?tenantId=${encodeURIComponent(tenantId)}` : "/admin/checkout-templates", { ttlMs: 1500 }),
    fetchChatwootInboxes()
  ]);

  const productItems = (products.json?.items ?? []) as any[];
  const total = Number(products.json?.total ?? productItems.length);
  const tenants = (tenantsRes.json?.items ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  const filteredCustomers = (customersRes.json?.items ?? []) as any[];
  const chatwootInboxes = (chatwootInboxesRes.items ?? chatwootInboxesRes.json?.items ?? []) as any[];

  const quickFilters = [
    {
      id: "gamification-legend",
      name: "Gamificación: Leyenda",
      category: "Gamificación",
      filters: { op: "and", rules: [{ field: "gamification.levelName", op: "in", value: ["Leyenda", "Maestro", "Elite", "Diamante"] }] }
    },
    {
      id: "gamification-oro",
      name: "Gamificación: Oro",
      category: "Gamificación",
      filters: { op: "and", rules: [{ field: "gamification.levelName", op: "in", value: ["Oro", "Platino"] }] }
    },
    {
      id: "gamification-plata",
      name: "Gamificación: Plata",
      category: "Gamificación",
      filters: { op: "and", rules: [{ field: "gamification.levelName", op: "in", value: ["Plata", "Bronce"] }] }
    },
    {
      id: "gamification-rookie",
      name: "Gamificación: Rookie",
      category: "Gamificación",
      filters: { op: "and", rules: [{ field: "gamification.levelName", op: "in", value: ["Rookie", "Explorador"] }] }
    }
  ];

  let activeFiltersKey = "";
  if (filters) {
    try {
      activeFiltersKey = JSON.stringify(JSON.parse(filters));
    } catch {
      activeFiltersKey = "";
    }
  }

  const iconForCategory = (category?: string) => {
    const key = String(category || "").toLowerCase();
    if (key.includes("gam")) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l2.4 6.4L21 9l-5 4 1.8 6-5.8-3.6L6.2 19 8 13 3 9l6.6-.6z" />
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
    return "default";
  };

  const buildQuickHref = (filtersObj: any) => {
    const sp = new URLSearchParams({
      ...(tenantId ? { tenantId } : {}),
      ...(q ? { q } : {}),
      filters: JSON.stringify(filtersObj)
    });
    return `/products?${sp.toString()}`;
  };

  return (
    <main className="page pageWide">
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Guardado.</div> : null}
      {contactCreated ? <div className="card cardPad">Contacto creado correctamente.</div> : null}
      {updated ? <div className="card cardPad">Actualizado.</div> : null}
      {deleted ? <div className="card cardPad">Eliminado.</div> : null}
      {tenantCreated ? <div className="card cardPad">Canal creado.</div> : null}
      {sent ? <div className="card cardPad">Mensaje enviado.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersNote">Gestiona productos y servicios y asócialos a contactos para crear planes o suscripciones.</div>
              <div className="filtersPanel">
                <div className="filtersQuickRow">
                  <div className="filtersQuick">
                    {quickFilters.map((filter) => {
                      const key = JSON.stringify(filter.filters);
                      const isActive = activeFiltersKey === key;
                      return (
                        <a
                          key={filter.id}
                          className={`pill quick-pill ${isActive ? "is-active" : ""}`}
                          href={buildQuickHref(filter.filters)}
                          data-tone={toneForCategory(filter.category)}
                        >
                          <span className="quick-pill-icon" aria-hidden="true">
                            {iconForCategory(filter.category)}
                          </span>
                          {filter.name}
                        </a>
                      );
                    })}
                  </div>
                </div>
                <div className="contacts-search-row">
                  <form action="/products" method="GET" className="filtersForm filtersSearch">
                    {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
                    {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
                    {filters ? <input type="hidden" name="filters" value={filters} /> : null}
                    <input
                      className="input"
                      type="search"
                      name="q"
                      defaultValue={q}
                      placeholder="Buscar producto o servicio..."
                      aria-label="Buscar productos"
                    />
                    <button className="ghost" type="submit">Buscar</button>
                  </form>
                  <SmartViewsBar
                    scope="products"
                    initialViewId={viewId}
                    initialFilters={filters}
                    baseParams={{
                      ...(tenantId ? { tenantId } : {}),
                      ...(q ? { q } : {})
                    }}
                    compactInline
                  />
                </div>
                <form action={createTenant} className="filtersForm">
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/products${
                      tenantId || q
                        ? `?${new URLSearchParams({
                            ...(tenantId ? { tenantId } : {}),
                            ...(q ? { q } : {})
                          }).toString()}`
                        : ""
                    }`}
                  />
                  <input className="input" name="name" placeholder="Nuevo canal" />
                  <button className="ghost btn-create" type="submit">Crear canal</button>
                </form>
              </div>
            </div>
            <div className="filtersRight">
              <span className="pill">{productItems.length} resultados</span>
            </div>
          </div>
        </div>

        <div className="settings-group-body">
          <div style={{ display: "grid", gap: 14 }}>
            <ProductsModals
              customers={filteredCustomers}
              products={productItems}
              checkoutTemplates={templatesRes.json?.items ?? []}
              csrfToken={csrfToken}
              tenants={tenants}
              tenantId={tenantId}
              createProduct={createProduct}
              createCustomer={createCustomerFromBilling}
              createPlanAndSubscription={createPlanAndSubscription}
              returnTo={returnTo}
            />

            <ProductsTable
              items={productItems.map((p) => {
                const ids = Array.isArray(p.tenantIds) && p.tenantIds.length ? p.tenantIds : [p.tenantId].filter(Boolean);
                const names = ids.map((id: string) => tenantById.get(String(id))).filter(Boolean) as string[];
                return {
                  ...p,
                  currency: String(p.currency || "COP"),
                  tenantId: tenantId || ids[0] || "",
                  tenantName: names.length ? names.join(", ") : "—",
                  tenantIds: ids
                };
              })}
              csrfToken={csrfToken}
              deleteProductAction={deleteProduct}
              tenants={tenants}
              customers={filteredCustomers}
              inboxes={chatwootInboxes}
              checkoutTemplates={templatesRes.json?.items ?? []}
              createCustomer={createCustomerFromBilling}
              createPlanAndSubscription={createPlanAndSubscription}
              returnTo={returnTo}
            />

            {(() => {
              const currentPage = Math.max(1, Number(page) || 1);
              const hasNext = total > 0 ? currentPage < Math.max(1, Math.ceil(total / take)) : productItems.length >= take;
              const totalPages = total > 0 ? Math.max(1, Math.ceil(total / take)) : currentPage + (hasNext ? 1 : 0);
              const desktopWindow = 10;
              let start = Math.max(1, currentPage - Math.floor(desktopWindow / 2));
              let end = start + (desktopWindow - 1);
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
                    href={`/products?${new URLSearchParams({
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
                          key={`products-page-${p}`}
                          className={`page-link ${p === currentPage ? "is-active" : ""} ${isDesktopOnly ? "page-desktop-only" : ""}`}
                          href={`/products?${new URLSearchParams({ ...baseParams, page: String(p) })}`}
                          aria-current={p === currentPage ? "page" : undefined}
                        >
                          {p}
                        </a>
                      );
                    })}
                  </div>
                  <a
                    className="page-link page-nav"
                    href={`/products?${new URLSearchParams({
                      ...baseParams,
                      page: String(currentPage + 1)
                    })}`}
                    aria-disabled={!hasNext}
                  >
                    Siguiente
                  </a>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

    </main>
  );
}
