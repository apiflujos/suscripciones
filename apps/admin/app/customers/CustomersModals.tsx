"use client";

import { useState } from "react";
import { NewCustomerForm } from "./NewCustomerForm";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";

export function CustomersModals({
  customers,
  products,
  checkoutTemplates,
  csrfToken,
  tenants,
  tenantId,
  createCustomer,
  createPlanAndSubscription,
  returnTo
}: {
  customers: any[];
  products: any[];
  checkoutTemplates: any[];
  csrfToken: string;
  tenants: Array<{ id: string; name: string }>;
  tenantId?: string;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
  returnTo: string;
}) {
  const [openCustomer, setOpenCustomer] = useState(false);
  const [openPlan, setOpenPlan] = useState(false);

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="primary" type="button" data-modal="true" onClick={() => setOpenCustomer(true)}>
          Crear contacto
        </button>
        <button className="primary" type="button" data-modal="true" onClick={() => setOpenPlan(true)}>
          Crear plan / suscripción
        </button>
      </div>

      {openCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 860 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Crear contacto</strong>
              <button className="ghost" type="button" onClick={() => setOpenCustomer(false)} aria-label="Cerrar">
                X
              </button>
            </div>
            <NewCustomerForm
              createCustomer={createCustomer}
              csrfToken={csrfToken}
              tenantId={tenantId}
              tenants={tenants}
              returnTo={returnTo}
              defaultOpen
              hidePanelHeader
              mode="always_open"
            />
          </div>
        </div>
      ) : null}

      {openPlan ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 980 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Crear plan o suscripción</strong>
              <button className="ghost" type="button" onClick={() => setOpenPlan(false)} aria-label="Cerrar">
                X
              </button>
            </div>
            <NewBillingAssignmentForm
              customers={customers}
              catalogItems={products}
              checkoutTemplates={checkoutTemplates}
              csrfToken={csrfToken}
              tenantId={tenantId}
              tenants={tenants}
              defaultOpen
              forceOpen
              hideHeader
              returnTo={returnTo}
              createCustomer={createCustomer}
              createPlanAndSubscription={createPlanAndSubscription}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
