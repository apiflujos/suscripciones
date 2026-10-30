import { PageShell } from "../../ui/PageShell";
import { getCsrfToken } from "../../lib/csrf";
import { resolveReturnTo } from "../../lib/returnTo";
import { normalizeErrorParam } from "../../lib/errorParam";
import { resolveTenantId } from "../../admin/_services/tenantResolver";
import { listCustomers } from "../../admin/_services/customers";
import { listCatalogProducts } from "../../admin/_services/products";
import { listEmpresas } from "../../admin/_services/companies";
import { listTenants } from "../../admin/_services/tenants";
import { createCustomerFromBilling, createPlanAndSubscription } from "../actions";
import { NewBillingAssignmentForm } from "../NewBillingAssignmentForm";

export const dynamic = "force-dynamic";

/**
 * Crear suscripción o cobro. Era un modal de 980 px sobre la lista; ahora es una
 * página con todo el formulario a la vista. "Crear contacto" lleva a su propia
 * página y regresa aquí con `selectCustomerId` ya elegido.
 */
export default async function NewBillingPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const csrfToken = await getCsrfToken();
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const resolvedTenantId = tenantId ? await resolveTenantId(tenantId) : null;
  const listHref = resolveReturnTo(sp.returnTo, "/billing");
  const selectCustomerId = typeof sp.selectCustomerId === "string" ? sp.selectCustomerId : "";
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : "");

  const [customers, products, empresasRes, tenants] = await Promise.all([
    listCustomers({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listCatalogProducts({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listEmpresas({ tenantId: resolvedTenantId || undefined, take: 200 }),
    listTenants()
  ]);

  // Al guardar se vuelve a la lista (con el resultado). Solo "Crear contacto" regresa
  // a esta misma página, con el contacto nuevo ya elegido.
  const selfHref = `/billing/new?returnTo=${encodeURIComponent(listHref)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ""}`;

  return (
    <PageShell
      title="Crear suscripción o cobro"
      subtitle="Elige el producto, el contacto y cómo se cobra."
      crumbs={[{ label: "Suscripciones", href: listHref }, { label: "Crear suscripción o cobro" }]}
      backHref={listHref}
      notice={error ? { tone: "error", text: error } : null}
      width="wide"
    >
      <NewBillingAssignmentForm
        customers={(customers.items ?? []) as any[]}
        empresas={(empresasRes?.items ?? []) as any[]}
        catalogItems={(products.items ?? []) as any[]}
        csrfToken={csrfToken}
        tenantId={tenantId || undefined}
        tenants={(tenants ?? []) as any[]}
        returnTo={listHref}
        selfReturnTo={selfHref}
        cancelHref={listHref}
        defaultOpen
        forceOpen
        hideHeader
        defaultSelectedCustomerId={selectCustomerId || undefined}
        createCustomer={createCustomerFromBilling}
        createPlanAndSubscription={createPlanAndSubscription}
      />
    </PageShell>
  );
}
