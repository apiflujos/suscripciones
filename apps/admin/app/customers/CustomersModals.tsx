"use client";

import { useState } from "react";
import { NewCustomerForm } from "./NewCustomerForm";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";
import { AppModal } from "../ui/AppModal";

export function CustomersModals({
  customers,
  empresas,
  products,
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

      <AppModal
        open={openCustomer}
        onClose={() => setOpenCustomer(false)}
        title="Crear contacto"
        maxWidth={860}
      >
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
      </AppModal>

      <AppModal
        open={openPlan}
        onClose={() => setOpenPlan(false)}
        title="Crear suscripción o cobro"
        maxWidth={980}
      >
        <NewBillingAssignmentForm
          customers={customers}
          empresas={empresas}
          catalogItems={products}
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
      </AppModal>
    </>
  );
}
