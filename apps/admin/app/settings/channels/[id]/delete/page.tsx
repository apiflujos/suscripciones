import { notFound } from "next/navigation";
import { listTenants } from "../../../../admin/_services/tenants";
import { PendingButton } from "../../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../../ui/PageShell";
import { getCsrfToken } from "../../../../lib/csrf";
import { deleteTenant } from "../../../../tenants/actions";

export const dynamic = "force-dynamic";

const LIST_HREF = "/settings?tab=canales";

/** Confirmar la eliminación de un canal (tenant): segundo paso dentro de una página. */
export default async function DeleteChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenants = (await listTenants()).filter((t: any) => t?.active !== false);
  const tenant = (tenants as any[]).find((t) => String(t.id) === id);
  if (!tenant) notFound();
  const csrfToken = await getCsrfToken();
  const name = String(tenant.name || "Canal");

  return (
    <PageShell
      title="Eliminar canal"
      subtitle={name}
      crumbs={[{ label: "Ajustes", href: "/settings" }, { label: "Canales de venta", href: LIST_HREF }, { label: name }]}
      backHref={LIST_HREF}
    >
      <form action={deleteTenant} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="tenantId" value={String(tenant.id)} />
        <input type="hidden" name="returnTo" value={LIST_HREF} />
        <PageSection
          title={`¿Eliminar el canal "${name}"?`}
          description="Esta acción no se puede deshacer. Si el canal tiene datos asociados, no se eliminará y se te indicará cuáles."
        >
          <p className="field-hint ui-alert-warn">Se eliminará el canal de la lista de canales de venta.</p>
        </PageSection>
        <FormActions cancelHref={LIST_HREF} cancelLabel="No, volver">
          <PendingButton className="ghost btn-compact btn-red btn-noicon" type="submit" pendingText="Eliminando...">
            Sí, eliminar canal
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
