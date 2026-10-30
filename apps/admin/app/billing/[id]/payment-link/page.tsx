import { HelpTip } from "../../../ui/HelpTip";
import { PendingButton } from "../../../ui/PendingButton";
import { FormActions, PageSection, PageShell } from "../../../ui/PageShell";
import { renderNotificationTemplatePreview, isNotificationTemplateConfigured, resolveNotificationTemplateForTrigger } from "../../../lib/notificationTemplate";
import { normalizeErrorParam } from "../../../lib/errorParam";
import { resolveReturnTo } from "../../../lib/returnTo";
import { sendWhatsAppPaymentLink } from "../../actions";
import { loadBillingRow } from "../../loadBillingRow";

export const dynamic = "force-dynamic";

/**
 * Enviar link de pago. Era un modal colgado de cada fila de la lista; ahora es una
 * página: el formulario, la vista previa del mensaje y los avisos caben completos.
 */
export default async function PaymentLinkPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/billing");
  const { row, csrfToken, notificationsRules, notificationsTemplates, helpers } = await loadBillingRow(id);

  const paymentType = "SUBSCRIPTION" as const;
  const template = resolveNotificationTemplateForTrigger({
    rules: notificationsRules,
    templates: notificationsTemplates,
    trigger: "PAYMENT_LINK_CREATED",
    paymentType
  });
  const hasTemplate = isNotificationTemplateConfigured(template);
  const blockedReason = helpers.getPaymentLinkBlockedReason(row);
  const canSend = hasTemplate && !blockedReason;
  const defaultAmountPesos = Math.trunc(Number(row.totalInCents || row.montoInCents || 0) / 100);
  const error = normalizeErrorParam(typeof sp.error === "string" ? sp.error : "");

  return (
    <PageShell
      title="Enviar link de pago"
      subtitle={`${row.customerName} · ${row.planName}`}
      crumbs={[{ label: "Suscripciones", href: returnTo }, { label: row.customerName }, { label: "Enviar link de pago" }]}
      backHref={returnTo}
      notice={error ? { tone: "error", text: error } : null}
    >
      <form action={sendWhatsAppPaymentLink} className="page-shell-body">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="subscriptionId" value={row.id} />
        <input type="hidden" name="customerId" value={row.customerId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {row.tenantId ? <input type="hidden" name="tenantId" value={row.tenantId} /> : null}

        <PageSection title="Monto" description="Deja vacío para usar el monto configurado en la suscripción.">
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>Monto (COP)</span>
              <HelpTip text="Deja vacío para usar el monto configurado en la suscripción." />
            </label>
            <input
              className="input"
              name="amountPesos"
              inputMode="numeric"
              placeholder={defaultAmountPesos ? `${defaultAmountPesos}` : "Ej: 390000"}
              defaultValue={defaultAmountPesos ? String(defaultAmountPesos) : ""}
            />
          </div>
        </PageSection>

        <PageSection
          title="Mensaje que recibirá el cliente"
          description="Se enviará usando la plantilla WhatsApp activa de Notificaciones para link de pago de suscripción."
        >
          <textarea className="input" rows={8} readOnly value={renderNotificationTemplatePreview(template)} />
          <label className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="sendNow" value="1" defaultChecked={canSend} disabled={!canSend} />
            <span>Enviar por WhatsApp al crear (Notificaciones)</span>
          </label>
          {!hasTemplate ? (
            <div className="field-hint ui-alert-warn">
              Falta una plantilla WhatsApp activa para link de pago de suscripción en Notificaciones. Configúrala antes de enviar.
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
            Enviar link
          </PendingButton>
        </FormActions>
      </form>
    </PageShell>
  );
}
