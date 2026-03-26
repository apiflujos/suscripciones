import { SmartViewsBar } from "../../smart-views/SmartViewsBar";
import { ViewModeToggles } from "../ViewModeToggles";
import { HelpTip } from "../HelpTip";

interface PageFiltersProps {
  searchPlaceholder?: string;
  smartViewScope: string;
  baseParams?: Record<string, string>;
  viewModes?: Array<"cards" | "lista" | "kanban">;
  filters?: React.ReactNode;
  initialViewId?: string;
  initialFilters?: string;
}

export function PageFilters({
  searchPlaceholder = "Buscar...",
  smartViewScope,
  baseParams = {},
  viewModes,
  filters,
  initialViewId = "",
  initialFilters = ""
}: PageFiltersProps) {
  return (
    <div className="page-filters">
      <div className="page-filters-row">
        <div className="page-filters-left">
          <form
            action={`/${smartViewScope}`}
            method="GET"
            className="filtersForm filtersSearch"
            style={{ flex: "0 0 280px" }}
            data-debounce-form="true"
          >
            {Object.entries(baseParams).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <input
              className="input"
              type="search"
              name="q"
              defaultValue=""
              placeholder={searchPlaceholder}
              aria-label="Buscar"
              title={searchPlaceholder}
            />
            <button
              className="ghost btn-icon-only btn-search"
              type="submit"
              aria-label="Buscar"
              title="Buscar"
            />
          </form>
          
          <div style={{ flex: "1 1 auto", minWidth: 200 }}>
            <SmartViewsBar
              scope={smartViewScope}
              initialViewId={initialViewId}
              initialFilters={initialFilters}
              baseParams={baseParams}
              compactInline
            />
          </div>
          
          {filters}
        </div>
        
        {viewModes && viewModes.length > 0 && (
          <div className="page-filters-right">
            <ViewModeToggles
              currentMode={viewModes[0]}
              baseParams={baseParams}
            />
          </div>
        )}
      </div>
    </div>
  );
}
