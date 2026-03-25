import { listEmpresas } from "../../admin/_services/companies";
import { getCsrfToken } from "../../lib/csrf";
import { ViewModeToggles } from "../../ui/ViewModeToggles";
import { deleteEmpresa } from "./actions";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";

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

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);

  const take = 20;
  const skip = Number.isFinite(page) && page > 1 ? (Math.trunc(page) - 1) * take : 0;
  const data = await listEmpresas({
    tenantId: session?.tenantId || null,
    take,
    skip,
    q: q.trim()
  });
  const items = (data.items ?? []) as any[];
  const total = Number.isFinite(Number(data.total)) ? Number(data.total) : items.length;
  const totalPages = Math.max(1, Math.ceil(total / take));
  const currentPage = Math.max(1, Number(page) || 1);

  const baseParams = {
    ...(q ? { q } : {}),
    ...(vista ? { vista } : {})
  };
  const pageHref = (p: number) => `/dashboard/empresas?${new URLSearchParams({ ...baseParams, page: String(p) })}`;

  return (
    <main className="page pageWide">
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Empresa creada.</div> : null}
      {updated ? <div className="card cardPad">Empresa actualizada.</div> : null}
      {deleted ? <div className="card cardPad">Empresa eliminada.</div> : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="filtersRow">
            <div className="filtersLeft">
              <div className="filtersPanel">
                <div className="contacts-search-row">
                  <form action="/dashboard/empresas" method="GET" className="filtersForm filtersSearch">
                    {vista ? <input type="hidden" name="vista" value={vista} /> : null}
                    <input
                      className="input"
                      type="search"
                      name="q"
                      defaultValue={q}
                      placeholder="Buscar empresa por nombre, email o teléfono..."
                      aria-label="Buscar empresas"
                    />
                    <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
                  </form>
                  <div className="products-search-right">
                    <div className="view-mode-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="field-hint" style={{ margin: 0 }}>Vista:</span>
                      <ViewModeToggles currentMode={vistaTyped} baseParams={baseParams} />
                    </div>
                  </div>
                </div>
                <div className="page-actions">
                  <a className="primary btn-create" href="/dashboard/empresas/new">
                    Crear empresa
                  </a>
                  <div className="page-actions-summary">{items.length} resultados</div>
                </div>
              </div>
            </div>
          </div>
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
                    <a className="ghost btn-compact btn-icon-only btn-edit" href={`/dashboard/empresas/${e.id}`} aria-label="Editar" title="Editar" />
                    <form action={deleteEmpresa}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="id" value={e.id} />
                      <button className="ghost btn-compact btn-icon-only btn-danger" type="submit" aria-label="Eliminar" title="Eliminar" />
                    </form>
                  </div>
                </div>
              ))}
              {items.length === 0 ? <div className="contact-empty">Sin empresas.</div> : null}
            </div>
          ) : (
            <div className="company-grid" aria-label="Listado de empresas">
              {items.map((e) => (
                <div className="company-card entity-card" key={e.id}>
                  <div className="entity-card-header">
                    <div>
                      <div className="company-name entity-card-title">{e.nombre}</div>
                      <div className="company-meta entity-card-sub">{e.email || "Sin email"}</div>
                    </div>
                  </div>
                  <div className="entity-card-grid">
                    <div>
                      <div className="field-hint">Teléfono</div>
                      <div>{e.telefono || "—"}</div>
                    </div>
                    <div>
                      <div className="field-hint">Contacto principal</div>
                      <div>{formatContactLabel(e.contactoPrincipal)}</div>
                    </div>
                    <div>
                      <div className="field-hint">Dirección</div>
                      <div>{e.direccion || "—"}</div>
                    </div>
                    <div>
                      <div className="field-hint">Sitio web</div>
                      <div>{e.sitioWeb || "—"}</div>
                    </div>
                  </div>
                  <div className="entity-card-actions">
                    <div className="entity-card-actions-left">
                      <a className="ghost btn-compact btn-noicon" href={`/dashboard/empresas/${e.id}`} aria-label="Ver detalle" title="Ver detalle">
                        Ver detalle
                      </a>
                    </div>
                    <div className="entity-card-actions-right">
                      <a className="ghost btn-compact btn-icon-only btn-edit" href={`/dashboard/empresas/${e.id}`} aria-label="Editar" title="Editar" />
                      <form action={deleteEmpresa}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="id" value={e.id} />
                        <button className="ghost btn-compact btn-icon-only btn-danger" type="submit" aria-label="Eliminar" title="Eliminar" />
                      </form>
                    </div>
                  </div>
                  <div className="entity-card-footer">
                    <div className="field-hint">Contactos</div>
                    <div className="entity-card-counts">
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

          <div className="pagination pagination-indicator" style={{ marginTop: 16 }}>
            <a className="page-link page-nav" href={pageHref(Math.max(1, currentPage - 1))} aria-disabled={currentPage <= 1}>
              Anterior
            </a>
            <div className="pagination-pages">
              <span className="page-link is-active">{currentPage}</span>
              <span className="page-link">{totalPages}</span>
            </div>
            <a className="page-link page-nav" href={pageHref(Math.min(totalPages, currentPage + 1))} aria-disabled={currentPage >= totalPages}>
              Siguiente
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
