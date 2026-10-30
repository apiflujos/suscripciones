import { notFound } from "next/navigation";
import { getSmartViewFields } from "@suscripciones/core/services/smartViews";
import { PageShell, PageSection } from "../../ui/PageShell";
import { SmartFilterBuilder } from "../../ui/SmartFilterBuilder";
import { resolveReturnTo } from "../../lib/returnTo";

export const dynamic = "force-dynamic";

const SCOPES = new Set(["billing", "customers", "products", "companies", "payments", "logs"]);

/**
 * Filtros inteligentes de una lista. Era un modal de 900 px sobre la lista; ahora es
 * una página: aplica el filtro (o guarda la lista inteligente) y vuelve a la lista
 * con la misma búsqueda y pestaña que traía.
 */
export default async function SmartFiltersPage({
  params,
  searchParams
}: {
  params: Promise<{ scope: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { scope } = await params;
  if (!SCOPES.has(scope)) notFound();
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/");
  const [path, query = ""] = returnTo.split("?");
  const baseParams = Object.fromEntries(new URLSearchParams(query).entries());
  delete baseParams.viewId;
  delete baseParams.filters;
  delete baseParams.page;

  return (
    <PageShell
      title="Filtros inteligentes"
      subtitle="Combina condiciones para acotar la lista; puedes guardarlas como lista inteligente."
      crumbs={[{ label: "Lista", href: returnTo }, { label: "Filtros inteligentes" }]}
      backHref={returnTo}
      width="wide"
    >
      <PageSection title="Condiciones">
        <SmartFilterBuilder
          scope={scope}
          returnPath={path}
          baseParams={baseParams}
          initialFields={getSmartViewFields(scope as any) as any}
          cancelHref={returnTo}
        />
      </PageSection>
    </PageShell>
  );
}
