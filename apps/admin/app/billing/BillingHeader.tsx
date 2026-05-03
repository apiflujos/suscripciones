import { BillingModals } from "./BillingModals";
import { FilterButton } from "../ui/FilterButton";
import { ListCsvActions } from "../ui/ListCsvActions";
import { PageToolbar } from "../ui/PageToolbar";
import { SmartViewsBar } from "../smart-views/SmartViewsBar";
import { ViewModeToggles } from "../ui/ViewModeToggles";
import { getSmartViewFields } from "@suscripciones/core/services/smartViews";
import type { BillingAction, BillingRow, TenantOption } from "./billingTypes";

type BillingHeaderProps = {
  filters: {
    tenantId: string;
    q: string;
    tipo: string;
    estado: string;
    ordenar: string;
    vista: "cards" | "lista" | "kanban";
    viewId: string;
    filters: string;
  };
  data: {
    rows: BillingRow[];
    tenants: TenantOption[];
    customerItems: unknown[];
    empresas: unknown[];
    productItems: unknown[];
    csrfToken: string;
    returnTo: string;
    exportHref: string;
    crear: string;
    selectCustomerId: string;
  };
  actions: {
    createCustomerFromBilling: (formData: FormData) => Promise<void>;
    createPlanAndSubscription: BillingAction;
  };
};

export function BillingHeader({ filters, data, actions }: BillingHeaderProps) {
  const baseParams = {
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.tipo ? { tipo: filters.tipo } : {}),
    ...(filters.estado ? { estado: filters.estado } : {}),
    ...(filters.ordenar ? { ordenar: filters.ordenar } : {})
  };

  return (
    <>
      <PageToolbar
        className="compact"
        search={(
          <form action="/billing" method="GET" className="filtersForm filtersSearch">
            {filters.tenantId ? <input type="hidden" name="tenantId" value={filters.tenantId} /> : null}
            {filters.tipo ? <input type="hidden" name="tipo" value={filters.tipo} /> : null}
            {filters.estado ? <input type="hidden" name="estado" value={filters.estado} /> : null}
            {filters.ordenar ? <input type="hidden" name="ordenar" value={filters.ordenar} /> : null}
            {filters.vista ? <input type="hidden" name="vista" value={filters.vista} /> : null}
            {filters.viewId ? <input type="hidden" name="viewId" value={filters.viewId} /> : null}
            {filters.filters ? <input type="hidden" name="filters" value={filters.filters} /> : null}
            <input
              className="input"
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Buscar por contacto, email o identificación..."
              aria-label="Buscar suscripciones"
            />
            <button className="ghost btn-icon-only btn-search" type="submit" aria-label="Buscar" title="Buscar" />
          </form>
        )}
        searchActions={(
          <FilterButton
            scope="billing"
            baseParams={baseParams}
            initialFields={getSmartViewFields("billing")}
          />
        )}
        smartViews={(
          <SmartViewsBar
            scope="billing"
            initialViewId={filters.viewId}
            initialFilters={filters.filters}
            baseParams={baseParams}
            initialFields={getSmartViewFields("billing")}
            compactInline
            hideFilterButton
          />
        )}
        views={(
          <ViewModeToggles
            currentMode={filters.vista}
            baseParams={baseParams}
            showKanban
          />
        )}
        configHref="/settings?tab=cobros"
        summary={<ListCsvActions exportHref={data.exportHref} tenantId={filters.tenantId} defaultEntity="payments" allowImport={false} />}
      />

      <div className="page-results-left">
        <span className="muted">{data.rows.length} resultados</span>
      </div>

      <div className="page-actions-right">
        <BillingModals
          customers={data.customerItems}
          empresas={data.empresas}
          catalogItems={data.productItems}
          csrfToken={data.csrfToken}
          tenantId={filters.tenantId}
          tenants={data.tenants}
          returnTo={data.returnTo}
          defaultOpen={Boolean(data.crear) || Boolean(data.selectCustomerId)}
          defaultSelectedCustomerId={data.selectCustomerId}
          createCustomer={actions.createCustomerFromBilling}
          createPlanAndSubscription={actions.createPlanAndSubscription}
        />
      </div>
    </>
  );
}
