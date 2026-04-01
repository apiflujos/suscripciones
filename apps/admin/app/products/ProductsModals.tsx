"use client";

import { useState } from "react";
import { NewProductForm } from "./NewProductForm";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";

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
            title="Crea un plan o una suscripción desde este producto"
          >
            Crear suscripción
          </button>
        ) : null}
      </div>

      {openProduct ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 980 }}>
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Crear producto / servicio</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpenProduct(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <NewProductForm action={createProduct} csrfToken={csrfToken} tenantId={tenantId} tenants={tenants} returnTo={returnTo} />
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
