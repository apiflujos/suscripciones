"use client";

import { useState } from "react";
import { NewBillingAssignmentForm } from "./NewBillingAssignmentForm";

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

      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 980 }}>
            <div className="panel-header ui-panel-header">
              <strong>Crear plan o suscripción</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
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
          </div>
        </div>
      ) : null}
    </>
  );
}
