import { normalizeErrorParam } from "../lib/errorParam";
import { getCsrfToken } from "../lib/csrf";
import { createCampaign, runCampaign } from "./actions";
import { RunCampaignButton } from "./RunCampaignButton";
import { NewMassMessageModal } from "./NewMassMessageModal";
import { listSmartViews, resolveSmartViewIds, parseFiltersParam, getSmartViewFields } from "@suscripciones/core/services/smartViews";
import { listCampaigns } from "../admin/_services/campaigns";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { PageHeaderStandard } from "../ui/PageHeaderStandard";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { FilterButton } from "../ui/FilterButton";

export default async function CampaignsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const tenantId = session?.tenantId || null;
  let lists: any[] = [];
  if (tenantId) {
    try {
      lists = await listSmartViews("customers", tenantId, session?.email || null);
    } catch {
      lists = [];
    }
  }
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const viewId = typeof sp.viewId === "string" ? sp.viewId : "";
  const filters = typeof sp.filters === "string" ? sp.filters : "";
  const returnTo = `/campaigns?${new URLSearchParams(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")) as Record<string, string>
  ).toString()}`;
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

  return (
    <div className="page pageWide campaignsPage">

      {normalizeErrorParam(sp.error) ? <div className="panel module">Error: {normalizeErrorParam(sp.error)}</div> : null}
      {sp.created ? <div className="panel module">Campaña guardada.</div> : null}
      {sp.running ? <div className="panel module">Campaña en cola.</div> : null}

      <PageHeaderStandard
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
            baseParams={{ ...(q ? { q } : {}), ...(viewId ? { viewId } : {}), ...(filters ? { filters } : {}) }}
            initialFields={getSmartViewFields("customers")}
          />
        )}
        filters={(
          <div className="page-header-standard-filters-group" />
        )}
        views={(
          <ViewModeToggles currentMode="lista" baseParams={{ ...(q ? { q } : {}), ...(viewId ? { viewId } : {}), ...(filters ? { filters } : {}) }} />
        )}
        smartViews={(
          <SmartViewsBar
            scope="customers"
            initialViewId={viewId}
            initialFilters={filters}
            baseParams={{
              ...(q ? { q } : {})
            }}
            initialFields={getSmartViewFields("customers")}
            compactInline
            hideFilterButton
          />
        )}
        summary={<span className="muted">Total {total}</span>}
      />

      <div className="campaigns-actions-right" style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <NewMassMessageModal
          csrfToken={csrfToken}
          returnTo={returnTo}
          views={lists
            .filter((v: any) => {
              const name = String(v?.name || "").toLowerCase();
              if (name.startsWith("gamificación")) return false;
              if (name.startsWith("ranking")) return false;
              if (name.startsWith("estado")) return false;
              return true;
            })
            .map((v: any) => ({
              id: String(v.id),
              name: String(v.name),
              visibility: v.visibility,
              type: v.type
            }))}
          tenantId={tenantId}
          action={createCampaign}
        />
      </div>

      <div className="panel module">
        <h3 style={{ marginTop: 0 }}>Campañas guardadas</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.length === 0 ? <div className="muted">No hay campañas aún.</div> : null}
          {items.map((c: any) => (
            <div key={c.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Enviados: {c.sentCount} · Fallidos: {c.failedCount} · Estado: {c.status}
                  </div>
                </div>
                <form action={runCampaign}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <RunCampaignButton
                    disabled={c.status === "RUNNING"}
                    label={c.sentCount > 0 ? "Reenviar" : "Enviar"}
                    name={c.name}
                    content={c.content}
                    template={c.templateParams || null}
                  />
                </form>
              </div>
              {c.content ? (
                <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 13 }}>
                  {c.content}
                </div>
              ) : null}
              {c.templateParams ? (() => {
                const tplName = String(c.templateParams?.name || "").trim();
                const tplLang = String(c.templateParams?.language || "").trim();
                const params = c.templateParams?.processed_params || null;
                return (
                  <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Plantilla WhatsApp: {tplName || "—"}{tplLang ? ` (${tplLang})` : ""}
                    </div>
                    {params ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {params.body?.length ? `Body: ${params.body.map((p: any) => p.value).join(" | ")}` : ""}
                        {params.header?.length ? ` · Header: ${params.header.map((p: any) => p.value).join(" | ")}` : ""}
                        {params.buttons?.length ? ` · Botones: ${params.buttons.map((p: any) => p.value).join(" | ")}` : ""}
                      </div>
                    ) : null}
                  </div>
                );
              })() : null}
            </div>
          ))}
        </div>
        {(() => {
          const currentPage = Math.max(1, Number(page) || 1);
          const hasNext = total > 0 ? currentPage < Math.max(1, Math.ceil(total / take)) : items.length >= take;
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
              <a className="page-link page-nav" href={`/campaigns?page=${Math.max(1, currentPage - 1)}`} aria-disabled={currentPage <= 1}>
                Anterior
              </a>
              <div className="pagination-pages" style={{ display: "none" }} />
              <a className="page-link page-nav" href={`/campaigns?page=${currentPage + 1}`} aria-disabled={!hasNext}>
                Siguiente
              </a>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
