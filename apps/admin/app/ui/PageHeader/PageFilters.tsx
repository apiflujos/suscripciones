import { SmartViewsBar } from "../../smart-views/SmartViewsBar";
import { ViewModeToggles } from "../ViewModeToggles";

interface PageFiltersProps {
  searchPlaceholder?: string;
  smartViewScope: string;
  baseParams?: Record<string, string>;
  viewModes?: Array<"cards" | "lista" | "kanban">;
  filters?: React.ReactNode;
  initialViewId?: string;
  initialFilters?: string;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
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
              className="ghost btn-compact btn-search"
              type="submit"
              aria-label="Buscar"
              title="Buscar"
            >
              <SearchIcon />
            </button>
          </form>

          <div style={{ flex: "1 1 auto", minWidth: 200 }}>
            <SmartViewsBar
              scope={smartViewScope}
              initialViewId={initialViewId}
              initialFilters={initialFilters}
              baseParams={baseParams}
              compactInline
              hideFilterButton
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
