import type { ReactNode } from "react";

export function PageHeaderStandard({
  actions,
  search,
  searchActions,
  smartViews,
  filters,
  views,
  summary,
  configHref,
  className
}: {
  actions?: ReactNode;
  search: ReactNode;
  searchActions?: ReactNode;
  smartViews?: ReactNode;
  filters?: ReactNode;
  views?: ReactNode;
  summary?: ReactNode;
  configHref?: string;
  className?: string;
}) {
  return (
    <div className={`page-header-standard${className ? ` ${className}` : ""}`}>
      <div className="page-header-standard-controls">
        <div className="page-header-standard-row page-header-standard-row-single">
          <div className="page-header-standard-search">
            <div className="page-header-standard-search-row">
              {search}
              {searchActions ? <div className="page-header-standard-search-actions">{searchActions}</div> : null}
            </div>
          </div>
          <div className={`page-header-standard-filters${filters ? "" : " is-empty"}`}>
            {filters ?? <span className="muted">Filtros</span>}
          </div>
          <div className={`page-header-standard-views${views ? "" : " is-empty"}`}>
            {views ?? <span className="muted">Vista</span>}
          </div>
          <div className={`page-header-standard-smartviews${smartViews ? "" : " is-empty"}`}>
            {smartViews ?? <span className="muted">Listas inteligentes</span>}
          </div>
          <div className="page-header-standard-right">
            {actions ? <div className="page-header-standard-actions">{actions}</div> : null}
            {configHref ? (
              <a
                className="ghost btn-compact btn-icon-only btn-gear"
                href={configHref}
                aria-label="Configuración"
                title="Configuración"
              />
            ) : null}
            {summary ? <div className="page-header-standard-summary">{summary}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
