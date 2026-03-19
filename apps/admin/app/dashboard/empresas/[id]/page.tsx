import { getEmpresaById } from "../../../admin/_services/companies";
import { EmpresaForm } from "../EmpresaForm";
import { getCsrfToken } from "../../../lib/csrf";
import { createEmpresa, updateEmpresa, deleteEmpresa } from "../actions";

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
  const error = typeof sp.error === "string" ? sp.error : "";
  const csrfToken = await getCsrfToken();

  const isNew = id === "new";
  const empresa = isNew ? null : await getEmpresaById(id);
  const contactos = empresa?.contactos || [];

  return (
    <main className="page pageWide">
      {error ? (
        <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
          Error: {error}
        </div>
      ) : null}
      {created ? <div className="card cardPad">Empresa creada correctamente.</div> : null}
      {updated ? <div className="card cardPad">Empresa actualizada.</div> : null}

      <EmpresaForm
        empresa={
          empresa
            ? {
                id: empresa.id,
                nombre: empresa.nombre,
                email: empresa.email,
                telefono: empresa.telefono,
                direccion: empresa.direccion,
                sitioWeb: empresa.sitioWeb,
                contactoPrincipalId: empresa.contactoPrincipalId
              }
            : null
        }
        contactos={contactos.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          email: c.email || "",
          telefono: c.telefono || "",
          cargo: c.cargo
        }))}
        csrfToken={csrfToken}
        createEmpresa={createEmpresa}
        updateEmpresa={updateEmpresa}
        deleteEmpresa={deleteEmpresa}
        returnTo="/dashboard/empresas"
      />
    </main>
  );
}
