"use client";

import { useState } from "react";
import { NewBillingAssignmentForm } from "./NewBillingAssignmentForm";
import { AppModal } from "../ui/AppModal";

export function BillingModals({
  customers,
  empresas,
  catalogItems,
  csrfToken,
  tenantId,
  tenants,
  returnTo,
  defaultOpen,
  defaultSelectedCustomerId,
  createCustomer,
  createPlanAndSubscription
}: {
  customers: any[];
  empresas: any[];
  catalogItems: any[];
  csrfToken: string;
  tenantId?: string;
  tenants: Array<{ id: string; name: string }>;
  returnTo: string;
  defaultOpen?: boolean;
  defaultSelectedCustomerId?: string | null;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <>
      <div className="customer-actions">
        <button className="primary btn-compact btn-subscription" type="button" data-modal="true" data-loader="off" onClick={() => setOpen(true)}>
          Crear suscripción
        </button>
      </div>

      <AppModal open={open} onClose={() => setOpen(false)} title="Crear plan o suscripción" maxWidth={980}>
        <NewBillingAssignmentForm
          customers={customers}
          empresas={empresas}
          catalogItems={catalogItems}
          csrfToken={csrfToken}
          tenantId={tenantId}
          tenants={tenants}
          returnTo={returnTo}
          defaultOpen
          forceOpen
          hideHeader
          defaultSelectedCustomerId={defaultSelectedCustomerId || undefined}
          createCustomer={createCustomer}
          createPlanAndSubscription={createPlanAndSubscription}
        />
      </AppModal>
    </>
  );
}
