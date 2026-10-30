import { PageShell } from "../../../ui/PageShell";
import { resolveReturnTo, withReturnTo } from "../../../lib/returnTo";
import { listCustomers } from "../../../admin/_services/customers";
import { listEmpresas } from "../../../admin/_services/companies";
import { createPlanAndSubscription } from "../../../billing/actions";
import { NewBillingAssignmentForm } from "../../../billing/NewBillingAssignmentForm";
import { formatMoneyFromCents, productErrorMessage } from "../../format";
import { listActiveTenants, loadProduct } from "../../loadProduct";
import "../../products.css";

export const dynamic = "force-dynamic";

/**
 * Crear suscripción desde un producto. Antes era un modal de 980 px colgado de cada
 * fila; ahora es una página y el producto llega ya elegido.
 */
export default async function ProductNewSubscriptionPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/products");
  const error = productErrorMessage(sp.error);
  const selectCustomerId = typeof sp.selectCustomerId === "string" ? sp.selectCustomerId : "";
  const { item, csrfToken, scopeTenantId } = await loadProduct(id);
  const [customersRes, empresasRes, tenants] = await Promise.all([
    listCustomers({ take: 200, tenantId: scopeTenantId }),
    listEmpresas({ tenantId: scopeTenantId, take: 200 }),
    listActiveTenants()
  ]);

  const selfHref = withReturnTo(`/products/${encodeURIComponent(item.id)}/new-subscription`, returnTo);

  return (
    <PageShell
      title="Crear suscripción desde producto"
      subtitle={`${item.name} · ${item.kind === "SERVICE" ? "Servicio" : "Producto"} · ${formatMoneyFromCents(item.basePriceInCents, item.currency)}`}
      crumbs={[{ label: "Productos", href: returnTo }, { label: item.name }, { label: "Crear suscripción" }]}
      backHref={returnTo}
      width="wide"
      notice={error ? { tone: "error", text: error } : null}
    >
      <div className="product-subscription-page">
        <NewBillingAssignmentForm
          customers={(customersRes.items ?? []) as any[]}
          empresas={(empresasRes?.items ?? []) as any[]}
          catalogItems={[item as any]}
          csrfToken={csrfToken}
          tenantId={item.tenantId || ""}
          tenants={tenants}
          defaultOpen
          forceOpen
          hideHeader
          returnTo={returnTo}
          defaultSelectedProductId={item.id}
          cancelHref={returnTo}
          selfReturnTo={selfHref}
          defaultSelectedCustomerId={selectCustomerId || undefined}
          createPlanAndSubscription={createPlanAndSubscription}
        />
      </div>
    </PageShell>
  );
}
