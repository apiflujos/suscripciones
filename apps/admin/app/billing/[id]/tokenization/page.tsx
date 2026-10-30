import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { isNotificationTemplateConfigured, renderNotificationTemplatePreview, resolveNotificationTemplateForTrigger } from "../../../lib/notificationTemplate";
import { sendWhatsAppTokenizationLink } from "../../actions";
import { loadSubscriptionPage } from "../../subscriptionPage";

export const dynamic = "force-dynamic";

/** Enviar link de tokenización (débito automático). Antes era un modal de la fila. */
export default async function TokenizationPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await loadSubscriptionPage(params, searchParams);
  const { row, csrfToken, notificationsRules, notificationsTemplates, helpers, returnTo } = ctx;

  const template = resolveNotificationTemplateForTrigger({
    rules: notificationsRules,
    templates: notificationsTemplates,
    trigger: "TOKENIZATION_LINK_CREATED"
  });
  const hasTemplate = isNotificationTemplateConfigured(template);
  const blockedReason = helpers.getTokenizationBlockedReason(row);
  const canSend = hasTemplate && !blockedReason;

  return (
    <PageShell
      title="Enviar link de tokenización"
      subtitle={ctx.subtitle}
      crumbs={ctx.crumbs("Enviar tokenización")}
      backHref={returnTo}
      notice={ctx.error ? { tone: "error", text: ctx.error } : null}
    >
      <form action={sendWhatsAppTokenizationLink} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="customerId" value={row.customerId} />
        {row.productId ? <input type="hidden" name="productId" value={row.productId} /> : null}
        {row.planId ? <input type="hidden" name="planId" value={row.planId} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}

        <PageSection
          title="Mensaje que recibirá el cliente"
          description="Se enviará usando la plantilla WhatsApp activa de Notificaciones para débito automático."
        >
          <textarea className="input" rows={8} readOnly value={renderNotificationTemplatePreview(template)} />
          {!hasTemplate ? (
            <div className="field-hint ui-alert-warn">
              Falta una plantilla WhatsApp activa para débito automático en Notificaciones. Configúrala antes de enviar.
              <div style={{ marginTop: 6 }}>
                <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                  Configurar plantilla
                </a>
              </div>
            </div>
          ) : null}
          {blockedReason ? <div className="field-hint ui-alert-warn">{blockedReason}</div> : null}
        </PageSection>

        <FormActions cancelHref={returnTo}>
          <PendingButton className="primary btn-compact btn-save" type="submit" pendingText="Enviando..." disabled={!canSend}>
            Enviar tokenización
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
