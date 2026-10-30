import { notFound } from "next/navigation";
import { getEmpresaById } from "../../../admin/_services/companies";
import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { getCsrfToken } from "../../../lib/csrf";
import { resolveReturnTo } from "../../../lib/returnTo";
import { deleteEmpresa } from "../../actions";
import { empresaErrorMessage } from "../../messages";

export const dynamic = "force-dynamic";

/** Confirmar la eliminación de una empresa: segundo paso, dentro de una página (sin ventana encima). */
export default async function EmpresaDeletePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/empresas");
  const error = empresaErrorMessage(sp.error);
  const empresa = await getEmpresaById(id);
  if (!empresa) notFound();
  const csrfToken = await getCsrfToken();
  const contactCount = (empresa.contactos || []).length;
  const back = `/empresas/${empresa.id}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <PageShell
      title="Eliminar empresa"
      subtitle={empresa.nombre}
      crumbs={[{ label: "Empresas", href: returnTo }, { label: empresa.nombre, href: back }, { label: "Eliminar" }]}
      backHref={back}
      notice={error ? { tone: "error", text: error } : null}
    >
      <form action={deleteEmpresa} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="id" value={empresa.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <PageSection
          title={`¿Eliminar "${empresa.nombre}"?`}
          description="Esta acción es permanente y no se puede deshacer."
        >
          <p className="field-hint ui-alert-warn">
            {contactCount
              ? `La empresa tiene ${contactCount} contacto${contactCount === 1 ? "" : "s"} asociado${contactCount === 1 ? "" : "s"}.`
              : "La empresa no tiene contactos asociados."}
          </p>
        </PageSection>
        <FormActions cancelHref={back}>
          <PendingButton className="ghost btn-compact btn-red" type="submit" pendingText="Eliminando...">
            Sí, eliminar empresa
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
