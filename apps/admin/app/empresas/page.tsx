import { PaginationBar } from "../PaginationBar";
import { listEmpresas } from "../admin/_services/companies";
import { getCsrfToken } from "../lib/csrf";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { FilterButton } from "../ui/FilterButton";
import { deleteEmpresa, createEmpresa, updateEmpresa } from "./actions";
import { EmpresaCreateModal } from "./EmpresaCreateModal";
import { RowActionsMenu } from "../billing/RowActionsMenu";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { PageToolbar } from "../ui/PageToolbar";
import { ListCsvActions } from "../ui/ListCsvActions";
import { resolveSmartViewIds, parseFiltersParam, getSmartViewFields } from "@suscripciones/core/services/smartViews";

export const dynamic = "force-dynamic";

function formatContactLabel(contact: any) {
  if (!contact) return "—";
  const name = String(contact?.nombre || "—");
  const cargo = String(contact?.cargo || "").trim();
  return cargo ? `${name} · ${cargo}` : name;
}

export default async function EmpresasPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const spParams = (await searchParams) ?? {};
  const created = typeof spParams.created === "string" ? spParams.created : "";
  const updated = typeof spParams.updated === "string" ? spParams.updated : "";
  const deleted = typeof spParams.deleted === "string" ? spParams.deleted : "";
  const error = typeof spParams.error === "string" ? spParams.error : "";
  const q = typeof spParams.q === "string" ? spParams.q : "";
  const page = typeof spParams.page === "string" ? Number(spParams.page) : 1;
  const vistaRaw = typeof spParams.vista === "string" ? spParams.vista : "cards";
  const vista = ["cards", "lista"].includes(vistaRaw) ? vistaRaw : "cards";
  const vistaTyped = vista as "cards" | "lista" | "kanban";
  const viewId = typeof spParams.viewId === "string" ? spParams.viewId : "";
  const filters = typeof spParams.filters === "string" ? spParams.filters : "";

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);

  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  let resolvedIds: string[] | null = null;
  if (viewId || filters) {
    const parsedFilters = filters ? parseFiltersParam(filters) : null;
    resolvedIds = await resolveSmartViewIds("companies", session?.tenantId || null, null, viewId || undefined, parsedFilters || undefined);
  }
  const ids = (viewId || filters) && resolvedIds && resolvedIds.length === 0 ? ["__none__"] : resolvedIds || undefined;
  const data = await listEmpresas({
    tenantId: session?.tenantId || null,
    take,
    skip,
    q: q.trim(),
    ids
  });
  const items = (data.items ?? []) as any[];
  const total = Number.isFinite(Number(data.total)) ? Number(data.total) : items.length;
  const totalPages = Math.max(1, Math.ceil(total / take));
  const currentPage = Math.max(1, Number(page) || 1);

  const baseParams = {
    ...(q ? { q } : {}),
    ...(vista ? { vista } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  };
  const pageHref = (p: number) => `/empresas?${new URLSearchParams({ ...baseParams, page: String(p) })}`;
  const exportHref = `/api/list-csv?${new URLSearchParams({
    scope: "companies",
    ...(q ? { q } : {}),
    ...(viewId ? { viewId } : {}),
    ...(filters ? { filters } : {})
  }).toString()}`;

  return (
    <main className="page pageWide empresasPage">
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Empresa creada.</div> : null}
      {updated ? <div className="card cardPad">Empresa actualizada.</div> : null}
      {deleted ? <div className="card cardPad">Empresa eliminada.</div> : null}

      <section className="settings-group">
        <PageToolbar
          className="compact"
          search={(
            <form action="/empresas" method="GET" className="filtersForm filtersSearch">
              {vista ? <input type="hidden" name="vista" value={vista} /> : null}
              {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
              {filters ? <input type="hidden" name="filters" value={filters} /> : null}
              <input
                className="input"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar empresa por nombre, email o teléfono..."
                aria-label="Buscar empresas"
                title="Busca por nombre, email o teléfono"
              />
              <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
            </form>
          )}
          searchActions={(
            <FilterButton
              scope="companies"
              baseParams={{
                ...(q ? { q } : {}),
                ...(viewId ? { viewId } : {}),
                ...(filters ? { filters } : {})
              }}
              initialFields={getSmartViewFields("companies")}
            />
          )}
          views={<ViewModeToggles currentMode={vistaTyped} baseParams={baseParams} />}
          summary={<ListCsvActions exportHref={exportHref} defaultEntity="companies" />}
        />

        <div className="customers-actions-right" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, marginBottom: 12 }}>
          <EmpresaCreateModal
            csrfToken={csrfToken}
            createEmpresa={createEmpresa}
            updateEmpresa={updateEmpresa}
            deleteEmpresa={deleteEmpresa}
            returnTo={`/empresas?${new URLSearchParams(baseParams).toString()}`}
            tenantId={session?.tenantId || null}
          />
        </div>

        <div className="settings-group-body">
          {vista === "lista" ? (
            <div className="company-list">
              <div className="company-list-header">
                <span>Empresa</span>
                <span>Contacto principal</span>
                <span>Contactos</span>
                <span>Acciones</span>
              </div>
              {items.map((e) => (
                <div className="company-list-row" key={e.id}>
                  <div className="company-list-cell">
                    <div className="company-name">{e.nombre}</div>
                    <div className="company-meta">
                      <span>{e.email || "Sin email"}</span>
                      <span>·</span>
                      <span>{e.telefono || "Sin teléfono"}</span>
                    </div>
                  </div>
                  <div className="company-list-cell">
                    <div className="company-contact">{formatContactLabel(e.contactoPrincipal)}</div>
                  </div>
                  <div className="company-list-cell">
                    <span className="pill pill-muted">{Number(e?._count?.contactos || 0)} contactos</span>
                  </div>
                  <div className="company-list-cell company-list-actions">
                    <RowActionsMenu label="Acciones de la empresa">
                      <a className="ghost btn-compact btn-edit btn-noicon" href={`/empresas/${e.id}`} title="Editar">
                        Editar
                      </a>
                      <form
                        action={deleteEmpresa}
                        onSubmit={(ev) => {
                          if (!confirm("¿Eliminar empresa?")) ev.preventDefault();
                        }}
                      >
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="id" value={e.id} />
                        <button className="ghost btn-compact btn-red btn-noicon" type="submit" title="Eliminar">
                          Eliminar
                        </button>
                      </form>
                    </RowActionsMenu>
                  </div>
                </div>
              ))}
              {items.length === 0 ? <div className="contact-empty">Sin empresas.</div> : null}
            </div>
          ) : (
            <div className="billing-grid" aria-label="Listado de empresas">
              {items.map((e) => (
                <div className="billing-card" key={e.id}>
                  <div className="billing-header">
                    <div className="billing-badges billing-badges-header">
                      <div className="billing-header-meta-grid">
                        <div className="billing-header-meta-item">
                          <span className="billing-header-label">
                            Empresa
                          </span>
                          <div className="billing-value">{e.nombre}</div>
                        </div>
                        <div className="billing-header-meta-item billing-header-status-strip">
                          <span className="billing-header-label">
                            Contacto
                          </span>
                          <div className="billing-status-line" role="group" aria-label="Contacto">
                            <span className="billing-sub" title={formatContactLabel(e.contactoPrincipal)}>
                              {formatContactLabel(e.contactoPrincipal)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="billing-header-right">
                      <div className="billing-header-actions">
                        <a className="ghost btn-compact btn-icon-only btn-edit" href={`/empresas/${e.id}`} aria-label="Editar" title="Editar" />
                        <form action={deleteEmpresa}>
                          <input type="hidden" name="csrf" value={csrfToken} />
                          <input type="hidden" name="id" value={e.id} />
                          <button className="ghost btn-compact btn-delete-icon btn-red" type="submit" aria-label="Eliminar" title="Eliminar" />
                        </form>
                      </div>
                    </div>
                  </div>

                  <div className="billing-body-main">
                    <div className="billing-body-section">
                      <div className="billing-section-title">Información</div>
                      <div className="billing-title">
                        <div className="billing-name billing-value">{e.nombre}</div>
                        <div className="billing-sub">{e.email || "Sin email"} {e.telefono ? `· ${e.telefono}` : ""}</div>
                      </div>
                    </div>
                    <div className="billing-body-section">
                      <div className="billing-section-title">Dirección</div>
                      <div className="billing-value">{e.direccion || "—"}</div>
                    </div>
                    <div className="billing-body-section">
                      <div className="billing-section-title">Sitio web</div>
                      <div className="billing-value">{e.sitioWeb || "—"}</div>
                    </div>
                  </div>

                  <div className="billing-footer">
                    <div className="billing-footer-section">
                      <span className="billing-footer-label">Contactos</span>
                      <span className="pill pill-sm pill-muted">
                        {Number(e?._count?.contactos || 0)} contactos
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {items.length === 0 ? <div className="contact-empty">Sin empresas.</div> : null}
            </div>
          )}

          <PaginationBar currentPage={currentPage} totalPages={totalPages} pageHref={pageHref} style={{ marginTop: 16 }} />
        </div>
      </section>
    </main>
  );
}
