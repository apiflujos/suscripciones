import Link from "next/link";
import { ProductsList } from "./ProductsList";
import { withReturnTo } from "../lib/returnTo";
import { ListCsvActions } from "../ui/ListCsvActions";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { FilterButton } from "../ui/FilterButton";
import { listCatalogProducts } from "../admin/_services/products";
import { PageToolbar } from "../ui/PageToolbar";
import "./products.css";
import { listTenants } from "../admin/_services/tenants";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { resolveSmartViewIds, parseFiltersParam, getSmartViewFields } from "@suscripciones/core/services/smartViews";
import { productErrorMessage } from "./format";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const spParams = (await searchParams) ?? {};
  const created = typeof spParams.created === "string" ? spParams.created : "";
  const contactCreated = typeof spParams.contactCreated === "string" ? spParams.contactCreated : "";
  const updated = typeof spParams.updated === "string" ? spParams.updated : "";
  const deleted = typeof spParams.deleted === "string" ? spParams.deleted : "";
  const tenantId = typeof spParams.tenantId === "string" ? spParams.tenantId : "";
  const tenantCreated = typeof spParams.tenantCreated === "string" ? spParams.tenantCreated : "";
  const error = productErrorMessage(spParams.error);
  const sent = typeof spParams.sent === "string" ? spParams.sent : "";
  const q = typeof spParams.q === "string" ? spParams.q : "";
  const page = typeof spParams.page === "string" ? Number(spParams.page) : 1;
  // La lista es la vista predeterminada en todo el producto: muestra más por
  // pantalla y deja comparar filas. Las tarjetas se quedan como opción, no como
  // punto de partida.
  const vistaRaw = typeof spParams.vista === "string" ? spParams.vista : "lista";
  const vista = ["cards", "lista"].includes(vistaRaw) ? vistaRaw : "lista";
  const vistaTyped = vista as "cards" | "lista" | "kanban";
  const viewId = typeof spParams.viewId === "string" ? spParams.viewId : "";
  const filters = typeof spParams.filters === "string" ? spParams.filters : "";
  const returnTo = `/products?${new URLSearchParams({
    ...(tenantId ? { tenantId } : {}),
    ...(q ? { q } : {}),
    ...(vista ? { vista } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page: String(page) } : {})
  }).toString()}`;
  const exportHref = `/api/list-csv?${new URLSearchParams({
    scope: "products",
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  }).toString()}`;

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const effectiveTenantId = tenantId ? tenantId : isSuperAdmin ? null : session?.tenantId || null;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const usingSmartFilters = Boolean(viewId || filters);
  let resolvedIds: string[] | null = null;
  if (viewId || filters) {
    const parsedFilters = filters ? parseFiltersParam(filters) : null;
    resolvedIds = await resolveSmartViewIds("products", effectiveTenantId, null, viewId || undefined, parsedFilters || undefined);
  }
  const ids = usingSmartFilters && resolvedIds && resolvedIds.length === 0 ? ["__none__"] : resolvedIds || undefined;
  const products = await listCatalogProducts({
    tenantId: effectiveTenantId,
    includeInactive: false,
    take,
    skip,
    q: q.trim(),
    ids
  });
  const tenants = await listTenants();

  const productItems = (products.items ?? []) as any[];
  const total = Number(products.total ?? productItems.length);
  const tenantList = (tenants ?? []) as Array<{ id: string; name: string }>;
  const tenantById = new Map(tenantList.map((t) => [String(t.id), String(t.name)]));
  const listItems = productItems.map((p) => {
    const ids = Array.isArray(p.tenantIds) && p.tenantIds.length ? p.tenantIds : [p.tenantId].filter(Boolean);
    const names = ids.map((id: string) => tenantById.get(String(id))).filter(Boolean) as string[];
    return {
      id: String(p.id),
      sku: String(p.sku || ""),
      name: String(p.name || ""),
      kind: (p.kind === "SERVICE" ? "SERVICE" : "PRODUCT") as "PRODUCT" | "SERVICE",
      currency: String(p.currency || "COP"),
      basePriceInCents: Number(p.basePriceInCents || 0),
      tenantName: names.length ? names.join(", ") : "—",
      imageUrl: p.imageUrl ? String(p.imageUrl) : null,
      activeSubscriptions: Number(p.activeSubscriptions || 0),
      pastDueSubscriptions: Number(p.pastDueSubscriptions || 0),
      totalSubscriptions: Number(p.totalSubscriptions || 0)
    };
  });

  return (
    <main className="page pageWide productsPage">
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
        <PageToolbar
          className="compact"
          search={(
            <form action="/products" method="GET" className="filtersForm filtersSearch">
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              {vista ? <input type="hidden" name="vista" value={vista} /> : null}
              {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
              {filters ? <input type="hidden" name="filters" value={filters} /> : null}
              <input
                className="input"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar producto o servicio..."
                aria-label="Buscar productos"
                title="Busca por nombre, SKU o tipo de producto"
              />
              <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
            </form>
          )}
          searchActions={(
            <FilterButton
              scope="products"
              baseParams={{
                ...(tenantId ? { tenantId } : {}),
                ...(q ? { q } : {}),
                ...(viewId ? { viewId } : {}),
                ...(filters ? { filters } : {})
              }}
              initialFields={getSmartViewFields("products")}
            />
          )}
          views={(
            <ViewModeToggles
              currentMode={vistaTyped}
              baseParams={{
                ...(tenantId ? { tenantId } : {}),
                ...(q ? { q } : {}),
                ...(viewId ? { viewId } : {}),
                ...(filters ? { filters } : {})
              }}
            />
          )}
          summary={(
            <>
              <span className="page-toolbar-count">{listItems.length} productos</span>
              <ListCsvActions exportHref={exportHref} tenantId={tenantId} defaultEntity="products" />
            </>
          )}
          actions={(
            <div className="page-toolbar-actions-inner">
              <Link
                className="primary btn-compact btn-create"
                href={withReturnTo("/products/new", returnTo)}
                data-loader="off"
                title="Crea un producto o servicio del catálogo"
              >
                Crear producto
              </Link>
            </div>
          )}
        />

        <div className="settings-group-body">
          <div style={{ display: "grid", gap: 14 }}>
            <ProductsList items={listItems} view={vista === "lista" ? "list" : "cards"} returnTo={returnTo} />

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
                  {currentPage <= 1 ? (
                    <span className="page-link page-nav" aria-disabled="true">
                      Anterior
                    </span>
                  ) : (
                    <a
                      className="page-link page-nav"
                      href={`/products?${new URLSearchParams({
                        ...baseParams,
                        page: String(Math.max(1, currentPage - 1))
                      })}`}
                    >
                      Anterior
                    </a>
                  )}
                  <div className="pagination-pages">
                    {pages.map((p) => (
                      <a key={p} className={`page-link${p === currentPage ? " is-active" : ""}`} href={`/products?${new URLSearchParams({ ...baseParams, page: String(p) })}`} aria-current={p === currentPage ? "page" : undefined}>{p}</a>
                    ))}
                  </div>
                  {!hasNext ? (
                    <span className="page-link page-nav" aria-disabled="true">
                      Siguiente
                    </span>
                  ) : (
                    <a
                      className="page-link page-nav"
                      href={`/products?${new URLSearchParams({
                        ...baseParams,
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
        </div>
      </section>
    </main>
  );
}
