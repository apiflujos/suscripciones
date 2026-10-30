import { PageShell, PageSection } from "../../../ui/PageShell";
import { getCsrfToken } from "../../../lib/csrf";
import { resolveReturnTo } from "../../../lib/returnTo";
import { getCustomerById } from "../../../admin/_services/customers";
import { listTenants } from "../../../admin/_services/tenants";
import { notFound } from "next/navigation";
import { deleteCustomer, updateCustomer } from "../../actions";
import { CustomerEditForm } from "../../CustomerEditForm";
import { TwoStepForm } from "../../TwoStepForm";

export const dynamic = "force-dynamic";

/**
 * Editar contacto (era el modal "Editar contacto"). También aloja "Eliminar
 * contacto", con confirmación en dos pasos dentro de la página.
 */
export default async function EditCustomerPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const [customer, tenants, csrfToken] = await Promise.all([getCustomerById(id), listTenants(), getCsrfToken()]);
  if (!customer) notFound();
  const returnTo = resolveReturnTo(sp.returnTo, `/customers/${customer.id}`);
  // Tras eliminar el contacto su ficha ya no existe: se vuelve a la lista.
  const afterDeleteTo = returnTo.startsWith(`/customers/${customer.id}`) ? "/customers" : returnTo;
  const label = customer.name || customer.email || customer.phone || "Contacto";

  return (
    <PageShell
      title="Editar contacto"
      subtitle={label}
      crumbs={[{ label: "Contactos", href: "/customers" }, { label, href: `/customers/${customer.id}` }, { label: "Editar" }]}
      backHref={returnTo}
    >
      <CustomerEditForm
        customer={customer as any}
        tenants={(tenants ?? []) as Array<{ id: string; name: string }>}
        csrfToken={csrfToken}
        returnTo={returnTo}
        updateCustomer={updateCustomer}
      />

      <PageSection title="Eliminar contacto" description="Esta acción borra el contacto y no se puede deshacer.">
        <div>
          <TwoStepForm
            action={deleteCustomer}
            fields={{
              csrf: csrfToken,
              id: customer.id,
              tenantId: String(customer.tenantId || customer.tenantIds?.[0] || ""),
              returnTo: afterDeleteTo
            }}
            triggerLabel="Eliminar contacto"
            prompt={`¿Seguro que quieres eliminar a ${label}? No se puede deshacer.`}
            confirmLabel="Sí, eliminar"
            pendingText="Eliminando..."
          />
        </div>
      </PageSection>
    </PageShell>
  );
}
