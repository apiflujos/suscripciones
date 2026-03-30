"use client";

import { useState } from "react";
import { NewCustomerForm } from "./NewCustomerForm";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";

export function CustomersModals({
  customers,
  empresas,
  products,
  checkoutTemplates,
  csrfToken,
  tenants,
  tenantId,
  createCustomer,
  createPlanAndSubscription,
  returnTo,
  actionsClassName,
  showPlanButton = true
}: {
  customers: any[];
  empresas: any[];
  products: any[];
  checkoutTemplates: any[];
  csrfToken: string;
  tenants: Array<{ id: string; name: string }>;
  tenantId?: string;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
  returnTo: string;
  actionsClassName?: string;
  showPlanButton?: boolean;
}) {
  const [openCustomer, setOpenCustomer] = useState(false);
  const [openPlan, setOpenPlan] = useState(false);

  return (
    <>
      <div className={actionsClassName || "customer-actions"}>
        <button
          className="primary btn-compact btn-contact"
          type="button"
          data-modal="true"
          data-loader="off"
          onClick={() => setOpenCustomer(true)}
          title="Crea un nuevo contacto con datos básicos y canal"
        >
          Crear contacto
        </button>
        {showPlanButton ? (
          <button
            className="primary btn-compact btn-subscription"
            type="button"
            data-modal="true"
            data-loader="off"
            onClick={() => setOpenPlan(true)}
            title="Crea un plan o una suscripción para un contacto o empresa"
          >
            Crear suscripción
          </button>
        ) : null}
      </div>

      {openCustomer ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 860 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Crear contacto</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpenCustomer(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
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
              useModal={false}
            />
          </div>
        </div>
      ) : null}

      {openPlan ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 980 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Crear plan o suscripción</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpenPlan(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <NewBillingAssignmentForm
              customers={customers}
              empresas={empresas}
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
