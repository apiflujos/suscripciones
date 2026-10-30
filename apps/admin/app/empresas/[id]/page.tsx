import { notFound } from "next/navigation";
import { getEmpresaById } from "../../admin/_services/companies";
import { PageShell } from "../../ui/PageShell";
import { EmpresaForm } from "../EmpresaForm";
import { getCsrfToken } from "../../lib/csrf";
import { resolveReturnTo } from "../../lib/returnTo";
import { createEmpresa, updateEmpresa } from "../actions";
import { empresaErrorMessage } from "../messages";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EmpresaDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const created = typeof sp.created === "string" ? sp.created : "";
  const updated = typeof sp.updated === "string" ? sp.updated : "";
  const error = empresaErrorMessage(sp.error);
  const returnTo = resolveReturnTo(sp.returnTo, "/empresas");
  const csrfToken = await getCsrfToken();

  if (id === "new") redirect("/empresas");
  const empresa = await getEmpresaById(id);
  if (!empresa) notFound();
  const contactos = empresa.contactos || [];

  const notice = error
    ? { tone: "error" as const, text: error }
    : created
      ? { tone: "ok" as const, text: "Empresa creada correctamente." }
      : updated
        ? { tone: "ok" as const, text: "Empresa actualizada." }
        : null;

  return (
    <PageShell
      title="Editar empresa"
      subtitle={empresa.nombre}
      crumbs={[{ label: "Empresas", href: returnTo }, { label: empresa.nombre }]}
      backHref={returnTo}
      notice={notice}
      width="wide"
    >
      <EmpresaForm
        empresa={{
          id: empresa.id,
          nombre: empresa.nombre,
          email: empresa.email,
          telefono: empresa.telefono,
          direccion: empresa.direccion,
          sitioWeb: empresa.sitioWeb,
          contactoPrincipalId: empresa.contactoPrincipalId
        }}
        contactos={contactos.map((c: { id: string; nombre: string; email?: string | null; telefono?: string | null; cargo: string }) => ({
          id: c.id,
          nombre: c.nombre,
          email: c.email || "",
          telefono: c.telefono || "",
          cargo: c.cargo
        }))}
        csrfToken={csrfToken}
        createEmpresa={createEmpresa}
        updateEmpresa={updateEmpresa}
        returnTo="/empresas"
        cancelHref={returnTo}
        deleteHref={`/empresas/${empresa.id}/delete?returnTo=${encodeURIComponent(returnTo)}`}
        hideHeader
        tenantId={empresa.tenantId || null}
      />
    </PageShell>
  );
}
