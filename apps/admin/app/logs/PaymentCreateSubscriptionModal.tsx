"use client";

import { useMemo, useState } from "react";
import { NewBillingAssignmentForm } from "../billing/NewBillingAssignmentForm";
import { AppModal } from "../ui/AppModal";

type BillingType = "PLAN" | "SUBSCRIPCION";

export function PaymentCreateSubscriptionModal({
  paymentId,
  customerId,
  tenantId,
  origin,
  customerName,
  customers,
  empresas,
  products,
  csrfToken,
  tenants,
  returnTo,
  createCustomer,
  createPlanAndSubscription
}: {
  paymentId: string;
  customerId: string;
  tenantId?: string;
  origin?: string | null;
  customerName?: string | null;
  customers: any[];
  empresas: any[];
  products: any[];
  csrfToken: string;
  tenants: Array<{ id: string; name: string }>;
  returnTo: string;
  createCustomer: (formData: FormData) => Promise<void>;
  createPlanAndSubscription: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const defaultBillingType = useMemo<BillingType>(() => {
    const mode = String(origin || "").trim().toUpperCase();
    if (mode === "AUTO_DEBIT") return "SUBSCRIPCION";
    if (mode === "AUTO_LINK" || mode === "MANUAL_LINK") return "PLAN";
    return "SUBSCRIPCION";
  }, [origin]);

  if (!paymentId || !customerId) return null;

  return (
    <>
      <button className="ghost btn-compact btn-noicon" type="button" onClick={() => setOpen(true)}>
        Crear suscripción
      </button>
      {open ? (
        <AppModal open={open} onClose={() => setOpen(false)} title="Crear suscripción para asociar pago" maxWidth={980}>
          <>
            <div className="field-hint modal-note">
              {customerName ? `El pago se asociará al contacto ${customerName}.` : "El pago recibido se asociará automáticamente a la suscripción creada."}
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
              defaultSelectedCustomerId={customerId}
              defaultBillingType={defaultBillingType}
              defaultExistingPaymentId={paymentId}
              createCustomer={createCustomer}
              createPlanAndSubscription={createPlanAndSubscription}
            />
          </>
        </AppModal>
      ) : null}
    </>
  );
}
