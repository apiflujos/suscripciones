import { PageShell } from "../../ui/PageShell";
import { productErrorMessage } from "../format";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { getCsrfToken } from "../../lib/csrf";
import { createProduct } from "../actions";
import { ProductForm } from "../ProductForm";
import { listActiveTenants } from "../loadProduct";

export const dynamic = "force-dynamic";

/** Crear producto / servicio. Antes era un modal en la barra de la lista. */
export default async function NewProductPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/products");
  const error = productErrorMessage(sp.error);
  const defaultTenantId = (() => {
    try {
      return new URL(returnTo, "http://localhost").searchParams.get("tenantId") || "";
    } catch {
      return "";
    }
  })();
  const [csrfToken, tenants] = await Promise.all([getCsrfToken(), listActiveTenants()]);

  return (
    <PageShell
      title="Crear producto / servicio"
      subtitle="Define el producto base del catálogo. Luego lo puedes usar para crear suscripciones."
      crumbs={[{ label: "Productos", href: returnTo }, { label: "Crear producto" }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
    >
      <ProductForm
        action={createProduct}
        csrfToken={csrfToken}
        tenants={tenants}
        returnTo={returnTo}
        failTo={withReturnTo("/products/new", returnTo)}
        defaultTenantId={defaultTenantId}
      />
    </PageShell>
  );
}
