import { normalizeErrorParam } from "../lib/errorParam";
import Link from "next/link";
import { RowActionsMenu } from "../billing/RowActionsMenu";
import { withReturnTo } from "../lib/returnTo";
import "./campaigns.css";
import { resolveSmartViewIds, parseFiltersParam, getSmartViewFields } from "@suscripciones/core/services/smartViews";
import { listCampaigns } from "../admin/_services/campaigns";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { PageToolbar } from "../ui/PageToolbar";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { FilterButton } from "../ui/FilterButton";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  RUNNING: "En envío",
  PAUSED: "Pausada",
  COMPLETED: "Completada",
  FAILED: "Fallida"
};

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const tenantId = session?.tenantId || null;
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  // La URL a la que vuelven las páginas de campaña: la lista con sus filtros, sin los avisos de resultado.
  const TRANSIENT = new Set(["created", "running", "error"]);
  const returnQuery = new URLSearchParams(
    Object.fromEntries(Object.entries(sp).filter(([k, v]) => typeof v === "string" && !TRANSIENT.has(k))) as Record<string, string>
  ).toString();
  const returnTo = returnQuery ? `/campaigns?${returnQuery}` : "/campaigns";
  const page = typeof sp.page === "string" ? Number(sp.page) : 1;
  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  let resolvedIds: string[] | null = null;
  if (viewId || filters) {
    const parsedFilters = filters ? parseFiltersParam(filters) : null;
    resolvedIds = await resolveSmartViewIds("campaigns", tenantId, null, viewId || undefined, parsedFilters || undefined);
  }
  const ids = (viewId || filters) && resolvedIds && resolvedIds.length === 0 ? ["__none__"] : resolvedIds || undefined;
  let campaignsRes: any = { ok: false };
  try {
    campaignsRes = await listCampaigns({ take, skip, ids, q });
  } catch {
    campaignsRes = { ok: false, items: [], total: 0 };
  }
  const items = campaignsRes.ok ? campaignsRes.items : [];
  const total = campaignsRes.ok ? Number(campaignsRes.total ?? items.length) : items.length;

  const baseParams = { ...(q ? { q } : {}), ...(viewId ? { viewId } : {}), ...(filters ? { filters } : {}) };
  const pageHref = (p: number) => `/campaigns?${new URLSearchParams({ ...baseParams, page: String(p) }).toString()}`;
  const currentPage = Math.max(1, Number(page) || 1);
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / take)) : currentPage;
  const hasNext = total > 0 ? currentPage < totalPages : items.length >= take;
  const windowStart = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, windowStart + 4);
  const pages: number[] = [];
  for (let i = windowStart; i <= windowEnd; i += 1) pages.push(i);

  return (
    <div className="page pageWide campaignsPage">
      {normalizeErrorParam(sp.error) ? <div className="panel module" role="alert">Error: {normalizeErrorParam(sp.error)}</div> : null}
      {sp.created ? <div className="panel module" role="status">Campaña guardada.</div> : null}
      {sp.running ? <div className="panel module" role="status">Campaña en cola.</div> : null}

      <section className="settings-group">
        <PageToolbar
          className="compact"
          search={(
            <form action="/campaigns" method="GET" className="filtersForm filtersSearch">
              {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
              {filters ? <input type="hidden" name="filters" value={filters} /> : null}
              <input
                className="input"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar por nombre o contenido..."
                aria-label="Buscar campañas"
              />
              <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
            </form>
          )}
          searchActions={(
            <FilterButton
              scope="customers"
              baseParams={baseParams}
              initialFields={getSmartViewFields("customers")}
            />
          )}
          views={<ViewModeToggles currentMode="lista" baseParams={baseParams} />}
          summary={<span className="page-toolbar-count">{total} campañas</span>}
          actions={(
            <Link className="primary btn-compact btn-create" href={withReturnTo("/campaigns/new", returnTo)} data-loader="off">
              Nueva campaña
            </Link>
          )}
        />

        <div className="settings-group-body">
          <div className="panel module">
            <h2 style={{ marginTop: 0, fontSize: 15 }}>Campañas guardadas</h2>
            <div className="cp-list">
              {items.length === 0 ? <div className="muted">No hay campañas aún.</div> : null}
              {items.map((c: any) => {
                const tplName = String(c.templateParams?.name || "").trim();
                const tplLang = String(c.templateParams?.language || "").trim();
                const runHref = withReturnTo(`/campaigns/${encodeURIComponent(c.id)}/run`, returnTo);
                const running = c.status === "RUNNING";
                return (
                  <div key={c.id} className="cp-row">
                    <div className="cp-main">
                      <div className="cp-title">{c.name}</div>
                      <div className="cp-stats">
                        <span>Enviados: {c.sentCount}</span>
                        <span>Fallidos: {c.failedCount}</span>
                      </div>
                      {c.content ? <p className="cp-content">{c.content}</p> : null}
                      {tplName ? (
                        <div className="cp-meta">
                          Plantilla WhatsApp: {tplName}
                          {tplLang ? ` (${tplLang})` : ""}
                        </div>
                      ) : null}
                    </div>
                    <span className={`pill ${c.status === "COMPLETED" ? "pill-green" : ""}`}>{STATUS_LABEL[c.status] || c.status}</span>
                    <div className="cp-actions">
                      <RowActionsMenu label={`Acciones de la campaña ${c.name}`}>
                        {running ? (
                          <span className="field-hint" style={{ padding: "4px 8px" }}>Enviándose…</span>
                        ) : (
                          <Link className="ghost btn-compact btn-noicon" href={runHref} data-loader="off">
                            {c.sentCount > 0 ? "Reenviar" : "Enviar"}
                          </Link>
                        )}
                      </RowActionsMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <nav className="pagination pagination-indicator" aria-label="Paginación">
            {currentPage <= 1 ? (
              <span className="page-link page-nav" aria-disabled="true">Anterior</span>
            ) : (
              <Link className="page-link page-nav" href={pageHref(currentPage - 1)}>Anterior</Link>
            )}
            <div className="pagination-pages">
              {pages.map((p) => (
                <Link key={p} className={`page-link${p === currentPage ? " is-active" : ""}`} href={pageHref(p)} aria-current={p === currentPage ? "page" : undefined}>
                  {p}
                </Link>
              ))}
            </div>
            {!hasNext ? (
              <span className="page-link page-nav" aria-disabled="true">Siguiente</span>
            ) : (
              <Link className="page-link page-nav" href={pageHref(currentPage + 1)}>Siguiente</Link>
            )}
          </nav>
        </div>
      </section>
    </div>
  );
}
