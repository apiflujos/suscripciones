import { PageShell } from "../../ui/PageShell";
import { getCsrfToken } from "../../lib/csrf";
import { customerErrorText } from "../errors";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { listTenants } from "../../admin/_services/tenants";
import { createCustomer } from "../actions";
import { NewCustomerForm } from "../NewCustomerForm";

export const dynamic = "force-dynamic";

/**
 * Crear contacto. Era un modal de la lista de contactos y del formulario de crear
 * suscripción. Acepta `?returnTo=…`: al guardar, la acción vuelve allí con
 * `selectCustomerId=<id nuevo>` para que quien lo pidió (p. ej. /billing/new) lo
 * deje seleccionado.
 */
export default async function NewCustomerPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/customers");
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : "";
  const [csrfToken, tenants] = await Promise.all([getCsrfToken(), listTenants()]);
  const error = customerErrorText(sp.error);
  const errorReturnTo = withReturnTo("/customers/new", returnTo);

  return (
    <PageShell
      title="Crear contacto"
      subtitle="Datos básicos, dirección (DANE) e identificación."
      crumbs={[{ label: "Contactos", href: returnTo }, { label: "Crear contacto" }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
    >
      <NewCustomerForm
        createCustomer={createCustomer}
        csrfToken={csrfToken}
        tenantId={tenantId}
        tenants={(tenants ?? []) as Array<{ id: string; name: string }>}
        returnTo={returnTo}
        errorReturnTo={errorReturnTo}
        cancelHref={returnTo}
      />
    </PageShell>
  );
}
