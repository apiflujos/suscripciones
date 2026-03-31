import type { ReactNode } from "react";
import { PageToolbar } from "./PageToolbar";

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
    <PageToolbar
      className={className}
      search={search}
      searchActions={searchActions}
      filters={filters}
      views={views}
      smartViews={smartViews}
      actions={actions}
      summary={summary}
      configHref={configHref}
    />
  );
}
