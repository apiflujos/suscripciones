import { PageSummary } from "./PageSummary";
import { PageTabs } from "./PageTabs";
import { PageActions } from "./PageActions";
import { PageFilters } from "./PageFilters";
import { HelpTip } from "../HelpTip";

type SummaryItem = {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  tip?: string;
};

type Tab = {
  label: string;
  href: string;
  active: boolean;
  count?: number;
};

interface PageHeaderProps {
  // Fila 1: Título + Acciones
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  titleTip?: string;
  
  // Fila 2: Resumen + Filtros
  summary?: SummaryItem[];
  tabs?: Tab[];
  
  // Filtros
  searchPlaceholder?: string;
  smartViewScope: string;
  baseParams?: Record<string, string>;
  viewModes?: Array<"cards" | "lista" | "kanban">;
  filters?: React.ReactNode;
  initialViewId?: string;
  initialFilters?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  titleTip,
  summary,
  tabs,
  searchPlaceholder,
  smartViewScope,
  baseParams = {},
  viewModes,
  filters,
  initialViewId = "",
  initialFilters = ""
}: PageHeaderProps) {
  return (
    <header className="page-header">
      {/* FILA 1: Título + Acciones */}
      <div className="page-header-row-1">
        <div className="page-title-group">
          <h1 className="page-title">
            {title}
            {titleTip && <HelpTip text={titleTip} />}
          </h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        
        {actions && (
          <div className="page-actions">
            {actions}
          </div>
        )}
      </div>
      
      {/* FILA 2: Resumen + Filtros */}
      {(summary || searchPlaceholder) && (
        <div className="page-header-row-2">
          {summary && summary.length > 0 && (
            <PageSummary items={summary} />
          )}
          
          {searchPlaceholder && (
            <PageFilters
              searchPlaceholder={searchPlaceholder}
              smartViewScope={smartViewScope}
              baseParams={baseParams}
              viewModes={viewModes}
              filters={filters}
              initialViewId={initialViewId}
              initialFilters={initialFilters}
            />
          )}
        </div>
      )}
    </header>
  );
}
