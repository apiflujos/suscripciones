import { PageShell } from "../../../../ui/PageShell";
import { NewBillingAssignmentForm } from "../../../../billing/NewBillingAssignmentForm";
import { createCustomerFromBilling, createPlanAndSubscription } from "../../../../billing/actions";
import { getCsrfToken } from "../../../../lib/csrf";
import { resolveReturnTo } from "../../../../lib/returnTo";
import { listCustomers } from "../../../../admin/_services/customers";
import { listCatalogProducts } from "../../../../admin/_services/products";
import { listEmpresas } from "../../../../admin/_services/companies";
import { listTenants } from "../../../../admin/_services/tenants";
import { loadPayment, requireSuperAdmin } from "../../../loadPayment";

export const dynamic = "force-dynamic";

/** Crear una suscripción y asociarle un pago ya recibido (antes, modal de 980 px). */
export default async function PaymentCreateSubscriptionPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/payments");
  const payment = await loadPayment(id);
  const customerId = String(payment.customer?.id || payment.subscription?.customer?.id || payment.customerId || "").trim();
  const customerName = String(payment.customer?.name || payment.subscription?.customer?.name || "").trim();
  const tenantId = String(payment.tenantId || "").trim();

  const [csrfToken, customersRes, productsRes, empresasRes, tenantsRes] = await Promise.all([
    getCsrfToken(),
    listCustomers({ tenantId: tenantId || undefined, take: 1, ids: customerId ? [customerId] : [] }),
    listCatalogProducts({ tenantId: tenantId || undefined, take: 300 }),
    listEmpresas({ tenantId: tenantId || undefined, take: 200 }),
    listTenants()
  ]);

  const mode = String(payment.origin || "").trim().toUpperCase();
  const billingType = mode === "AUTO_LINK" || mode === "MANUAL_LINK" ? "PLAN" : "SUBSCRIPCION";
  const canCreate = Boolean(customerId) && !payment.subscriptionId;

  return (
    <PageShell
      title="Crear suscripción para asociar pago"
      subtitle={customerName ? `Contacto: ${customerName}` : undefined}
      crumbs={[{ label: "Pagos", href: returnTo }, { label: customerName || "Pago" }, { label: "Crear suscripción" }]}
      backHref={returnTo}
      width="wide"
    >
      {canCreate ? (
        <>
          <p className="field-hint">
            {customerName
              ? `El pago se asociará al contacto ${customerName}.`
              : "El pago recibido se asociará automáticamente a la suscripción creada."}
          </p>
          <NewBillingAssignmentForm
            customers={((customersRes as any)?.items ?? []) as any[]}
            empresas={((empresasRes as any)?.items ?? []) as any[]}
            catalogItems={((productsRes as any)?.items ?? []) as any[]}
            csrfToken={csrfToken}
            tenantId={tenantId || undefined}
            tenants={(tenantsRes ?? []) as Array<{ id: string; name: string }>}
            defaultOpen
            forceOpen
            hideHeader
            returnTo={returnTo}
            defaultSelectedCustomerId={customerId}
            defaultBillingType={billingType}
            defaultExistingPaymentId={String(payment.id)}
            createCustomer={createCustomerFromBilling}
            createPlanAndSubscription={createPlanAndSubscription}
          />
        </>
      ) : (
        <p className="field-hint ui-alert-warn">
          {payment.subscriptionId
            ? "Este pago ya está asociado a una suscripción."
            : "Este pago no tiene un contacto asociado; no se puede crear la suscripción desde aquí."}
        </p>
      )}
    </PageShell>
  );
}
