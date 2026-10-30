import { generateWebhookSecret } from "@suscripciones/core/services/webhookSecrets";
import { PageShell } from "../../../ui/PageShell";
import { getCsrfToken } from "../../../lib/csrf";
import { WEBHOOKS_LIST_HREF, WebhookEndpointForm } from "../WebhookEndpointForm";

export const dynamic = "force-dynamic";

/** Nuevo webhook (antes un modal sobre la pestaña Integraciones). */
export default async function NewWebhookPage() {
  const csrfToken = await getCsrfToken();
  return (
    <PageShell
      title="Nuevo webhook"
      subtitle="Endpoint adicional para recibir eventos de otra pasarela."
      crumbs={[{ label: "Ajustes", href: "/settings" }, { label: "Integraciones", href: WEBHOOKS_LIST_HREF }, { label: "Nuevo webhook" }]}
      backHref={WEBHOOKS_LIST_HREF}
    >
      <WebhookEndpointForm csrfToken={csrfToken} suggestedSecret={generateWebhookSecret()} />
    </PageShell>
  );
}
