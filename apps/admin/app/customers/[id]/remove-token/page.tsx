import { notFound } from "next/navigation";
import { hasActiveCustomerPaymentSource } from "@suscripciones/core/lib/customerMetadata";
import { PageShell, PageSection } from "../../../ui/PageShell";
import { resolveReturnTo } from "../../../lib/returnTo";
import { getCustomerById } from "../../../admin/_services/customers";
import { RemoveTokenPanel } from "../../RemoveTokenPanel";

export const dynamic = "force-dynamic";

/** Quitar el token (método de pago guardado) de un contacto. */
export default async function RemoveTokenPage({
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
  const label = customer.name || customer.email || customer.phone || "Contacto";
  const hasToken = hasActiveCustomerPaymentSource(customer.metadata);

  return (
    <PageShell
      title="Quitar método de pago"
      subtitle={label}
      crumbs={[{ label: "Contactos", href: "/customers" }, { label, href: `/customers/${customer.id}` }, { label: "Quitar método de pago" }]}
      backHref={returnTo}
    >
      {hasToken ? (
        <>
          <PageSection
            title="Método de pago guardado"
            description="Al quitarlo, este contacto queda sin tarjeta tokenizada y los cobros automáticos dejan de funcionar hasta que guarde otro."
          >
            <span className="pill pill-ok pill-sm">Tokenizada</span>
          </PageSection>
          <RemoveTokenPanel customerId={customer.id} returnTo={returnTo} />
        </>
      ) : (
        <PageSection title="Sin método de pago" description="Este contacto no tiene un método de pago guardado.">
          <div>
            <a className="ghost btn-compact" href={returnTo}>
              Volver
            </a>
          </div>
        </PageSection>
      )}
    </PageShell>
  );
}
