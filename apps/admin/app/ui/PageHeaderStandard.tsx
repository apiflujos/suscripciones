import type { ReactNode } from "react";

export function PageHeaderStandard({
  title,
  subtitle,
  actions,
  search,
  smartViews,
  filters,
  views,
  summary
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  search: ReactNode;
  smartViews?: ReactNode;
  filters?: ReactNode;
  views?: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <div className="page-header-standard">
      <div className="page-header-standard-top">
        <div className="page-header-standard-title">
          <h1 className="page-title-standard">{title}</h1>
          {subtitle ? <div className="page-subtitle-standard">{subtitle}</div> : null}
        </div>
        {actions ? <div className="page-header-standard-actions">{actions}</div> : null}
      </div>
      <div className="page-header-standard-controls">
        <div className="page-header-standard-search">{search}</div>
        <div className="page-header-standard-left">
          <div className={`page-header-standard-filters${filters ? "" : " is-empty"}`}>
            {filters ?? <span className="muted">Filtros</span>}
          </div>
          <div className={`page-header-standard-views${views ? "" : " is-empty"}`}>
            {views ?? <span className="muted">Vista</span>}
          </div>
        </div>
        <div className={`page-header-standard-smartviews${smartViews ? "" : " is-empty"}`}>
          {smartViews ?? <span className="muted">Listas inteligentes</span>}
        </div>
        <div className="page-header-standard-right">
          {summary ? <div className="page-header-standard-summary">{summary}</div> : null}
        </div>
      </div>
    </div>
  );
}
