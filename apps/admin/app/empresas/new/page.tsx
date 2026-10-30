import { PageShell } from "../../ui/PageShell";
import { EmpresaForm } from "../EmpresaForm";
import { getCsrfToken } from "../../lib/csrf";
import { resolveReturnTo, withReturnTo } from "../../lib/returnTo";
import { createEmpresa, updateEmpresa } from "../actions";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import { empresaErrorMessage } from "../messages";

export const dynamic = "force-dynamic";

/** Crear empresa. Antes era un modal sobre la lista de Empresas. */
export default async function NuevaEmpresaPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/empresas");
  const error = empresaErrorMessage(sp.error);
  const csrfToken = await getCsrfToken();
  const c = await cookies();
  const session = await verifyAdminSessionToken(c.get(ADMIN_SESSION_COOKIE)?.value || "");

  return (
    <PageShell
      title="Nueva empresa"
      subtitle="Crea la empresa y asocia contactos."
      crumbs={[{ label: "Empresas", href: returnTo }, { label: "Nueva empresa" }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
      width="wide"
    >
      <EmpresaForm
        empresa={null}
        contactos={[]}
        csrfToken={csrfToken}
        createEmpresa={createEmpresa}
        updateEmpresa={updateEmpresa}
        // Los errores vuelven a esta misma página, conservando el retorno a la lista.
        returnTo={withReturnTo("/empresas/new", returnTo)}
        cancelHref={returnTo}
        hideHeader
        tenantId={session?.tenantId || null}
      />
    </PageShell>
  );
}
