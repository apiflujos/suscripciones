import { PageShell } from "../ui/PageShell";
import { resolveReturnTo } from "../lib/returnTo";
import { ImportCsvForm } from "./ImportCsvForm";

export const dynamic = "force-dynamic";

const ENTITIES = new Set(["customers", "products", "companies", "payments"]);

/** Importar datos en CSV. Era un modal de las listas; ahora es una página. */
export default async function ImportPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const entityRaw = typeof sp.entity === "string" ? sp.entity : "customers";
  const entity = (ENTITIES.has(entityRaw) ? entityRaw : "customers") as "customers" | "products" | "companies" | "payments";
  const tenantId = typeof sp.tenantId === "string" ? sp.tenantId : undefined;
  const backHref = resolveReturnTo(sp.returnTo, "/");

  return (
    <PageShell
      title="Importar datos en CSV"
      subtitle="Descarga la plantilla, llénala y súbela."
      crumbs={[{ label: "Lista", href: backHref }, { label: "Importar CSV" }]}
      backHref={backHref}
    >
      <ImportCsvForm defaultEntity={entity} tenantId={tenantId} backHref={backHref} />
    </PageShell>
  );
}
