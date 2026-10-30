import { notFound } from "next/navigation";
import { PageShell } from "../../../ui/PageShell";
import { getCsrfToken } from "../../../lib/csrf";
import { normalizeErrorParam } from "../../../lib/errorParam";
import { resolveReturnTo } from "../../../lib/returnTo";
import { getCustomerById } from "../../../admin/_services/customers";
import { listCatalogProducts } from "../../../admin/_services/products";
import { listEmpresas } from "../../../admin/_services/companies";
import { listTenants } from "../../../admin/_services/tenants";
import { createPlanAndSubscription } from "../../../billing/actions";
import { NewBillingAssignmentForm } from "../../../billing/NewBillingAssignmentForm";
import { createCustomer } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Crear suscripción o cobro para un contacto (era un modal de 980 px en la lista).
 * Reutiliza el formulario y la acción de Suscripciones (`createPlanAndSubscription`).
 */
export default async function CustomerNewSubscriptionPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const customer = await getCustomerById(id);
  if (!customer) notFound();
  const returnTo = resolveReturnTo(sp.returnTo, `/customers/${customer.id}`);
  const tenantId = String(customer.tenantId || customer.tenantIds?.[0] || "");
  const [csrfToken, tenants, products, empresas] = await Promise.all([
    getCsrfToken(),
    listTenants(),
    listCatalogProducts({ tenantId: tenantId || null, take: 300 }),
    listEmpresas({ tenantId: tenantId || "", take: 200 })
  ]);
  const label = customer.name || customer.email || customer.phone || "Contacto";
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : "");

  return (
    <PageShell
      title="Crear suscripción o cobro"
      subtitle={label}
      crumbs={[{ label: "Contactos", href: "/customers" }, { label, href: `/customers/${customer.id}` }, { label: "Crear suscripción o cobro" }]}
      backHref={returnTo}
      width="wide"
      notice={error ? { tone: "error", text: error } : null}
    >
      <NewBillingAssignmentForm
        customers={[customer as any]}
        empresas={(empresas?.items ?? []) as any[]}
        catalogItems={((products as any)?.items ?? []) as any[]}
        csrfToken={csrfToken}
        tenantId={tenantId}
        tenants={(tenants ?? []) as Array<{ id: string; name: string }>}
        defaultOpen
        forceOpen
        hideHeader
        returnTo={returnTo}
        defaultSelectedCustomerId={customer.id}
        createCustomer={createCustomer}
        createPlanAndSubscription={createPlanAndSubscription}
      />
    </PageShell>
  );
}
