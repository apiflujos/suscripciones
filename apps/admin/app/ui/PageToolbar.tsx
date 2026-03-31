import type { ReactNode } from "react";

export function PageToolbar({
  search,
  searchActions,
  filters,
  views,
  smartViews,
  actions,
  summary,
  configHref,
  className
}: {
  search: ReactNode;
  searchActions?: ReactNode;
  filters?: ReactNode;
  views?: ReactNode;
  smartViews?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  configHref?: string;
  className?: string;
}) {
  return (
    <div className={`page-toolbar${className ? ` ${className}` : ""}`}>
      <div className="page-toolbar-row page-toolbar-row-1">
        <div className="page-toolbar-search">
          <div className="page-toolbar-search-row">
            {search}
            {searchActions ? <div className="page-toolbar-search-actions">{searchActions}</div> : null}
          </div>
        </div>
        {filters ? <div className="page-toolbar-filters">{filters}</div> : null}
      </div>

      <div className="page-toolbar-row page-toolbar-row-2">
        {views ? <div className="page-toolbar-views">{views}</div> : null}
        <div className="page-toolbar-right">
          {smartViews ? <div className="page-toolbar-smartviews">{smartViews}</div> : null}
          {actions ? <div className="page-toolbar-actions">{actions}</div> : null}
          {configHref ? (
            <a
              className="ghost btn-compact btn-icon-only btn-gear"
              href={configHref}
              aria-label="Configuración"
              title="Configuración"
            />
          ) : null}
          {summary ? <div className="page-toolbar-summary">{summary}</div> : null}
        </div>
      </div>
    </div>
  );
}
