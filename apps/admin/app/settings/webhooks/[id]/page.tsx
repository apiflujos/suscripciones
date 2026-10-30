import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/session";
import { listWebhookEndpoints } from "../../../admin/_services/webhookEndpoints";
import { listTenants } from "../../../admin/_services/tenants";
import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { getCsrfToken } from "../../../lib/csrf";
import { deleteWebhookEndpointAction } from "../../actions";
import { WEBHOOKS_LIST_HREF, WebhookEndpointForm } from "../WebhookEndpointForm";

export const dynamic = "force-dynamic";

/** Editar un webhook; con `?confirmDelete=1` muestra el segundo paso de "Eliminar". */
export default async function EditWebhookPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const confirmDelete = String(sp.confirmDelete || "") === "1";
  const csrfToken = await getCsrfToken();

  // Mismo criterio de tenant que la pestaña Integraciones.
  const c = await cookies();
  const session = await verifyAdminSessionToken(c.get(ADMIN_SESSION_COOKIE)?.value || "");
  const tenants = (await listTenants()).filter((t: any) => t?.active !== false);
  const tenantId = String(session?.tenantId || "").trim() || String(tenants?.[0]?.id || "").trim();
  let endpoints: any[] = [];
  if (tenantId) {
    try {
      endpoints = await listWebhookEndpoints(tenantId);
    } catch {
      endpoints = [];
    }
  }
  const endpoint = endpoints.find((e) => e.id === id);
  if (!endpoint) notFound();
  const self = `/settings/webhooks/${encodeURIComponent(id)}`;

  return (
    <PageShell
      title={confirmDelete ? "Eliminar webhook" : "Editar webhook"}
      subtitle={endpoint.name}
      crumbs={[{ label: "Ajustes", href: "/settings" }, { label: "Integraciones", href: WEBHOOKS_LIST_HREF }, { label: endpoint.name }]}
      backHref={WEBHOOKS_LIST_HREF}
    >
      {confirmDelete ? (
        <form action={deleteWebhookEndpointAction} className="page-shell-body">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="returnTo" value={WEBHOOKS_LIST_HREF} />
          <input type="hidden" name="id" value={endpoint.id} />
          <PageSection
            title={`¿Eliminar el webhook "${endpoint.name}"?`}
            description="La pasarela dejará de poder enviar eventos a este endpoint."
          >
            <p className="field-hint ui-alert-warn">Esta acción no se puede deshacer.</p>
          </PageSection>
          <FormActions cancelHref={self} cancelLabel="No, volver">
            <PendingButton className="ghost btn-compact btn-red btn-noicon" type="submit" pendingText="Eliminando...">
              Sí, eliminar webhook
            </PendingButton>
          </FormActions>
        </form>
      ) : (
        <WebhookEndpointForm
          csrfToken={csrfToken}
          endpoint={{ id: endpoint.id, name: endpoint.name, provider: String(endpoint.provider), active: Boolean(endpoint.active) }}
          deleteHref={`${self}?confirmDelete=1`}
        />
      )}
    </PageShell>
  );
}
