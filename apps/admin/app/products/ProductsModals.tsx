"use client";

import { useState } from "react";
import { NewProductForm } from "./NewProductForm";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";
import { AppModal } from "../ui/AppModal";

export function ProductsModals({
  customers,
  empresas,
  products,
  csrfToken,
  tenants,
  tenantId,
  createProduct,
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
  createProduct: (formData: FormData) => void | Promise<void>;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
  returnTo: string;
  actionsClassName?: string;
  showPlanButton?: boolean;
}) {
  const [openProduct, setOpenProduct] = useState(false);
  const [openPlan, setOpenPlan] = useState(false);

  return (
    <>
      <div className={actionsClassName || "customer-actions"}>
        <button
          className="primary btn-compact btn-create"
          type="button"
          data-modal="true"
          data-loader="off"
          onClick={() => setOpenProduct(true)}
          title="Crea un producto o servicio del catálogo"
        >
          Crear producto
        </button>
        {showPlanButton ? (
          <button
            className="primary btn-compact btn-subscription"
            type="button"
            data-modal="true"
            data-loader="off"
            onClick={() => setOpenPlan(true)}
            title="Crea una suscripción a partir de este producto"
          >
            Crear suscripción
          </button>
        ) : null}
      </div>

      {openProduct ? (
        <AppModal open={openProduct} onClose={() => setOpenProduct(false)} title="Crear producto / servicio" maxWidth={980}>
            <NewProductForm action={createProduct} csrfToken={csrfToken} tenantId={tenantId} tenants={tenants} returnTo={returnTo} />
        </AppModal>
      ) : null}

      {openPlan ? (
        <AppModal open={openPlan} onClose={() => setOpenPlan(false)} title="Crear suscripción desde producto" maxWidth={980}>
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
      ) : null}
    </>
  );
}
