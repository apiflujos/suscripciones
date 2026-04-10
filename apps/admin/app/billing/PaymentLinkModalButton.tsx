"use client";

import { useEffect, useRef, useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { HelpTip } from "../ui/HelpTip";
import { AppModal } from "../ui/AppModal";
import { isNotificationTemplateConfigured, renderNotificationTemplatePreview } from "../lib/notificationTemplate";

export function PaymentLinkModalButton({
  subscriptionId,
  customerId,
  tenantId,
  csrfToken,
  returnTo,
  defaultAmountPesos,
  notificationTemplates,
  notificationRules,
  paymentType = "LINK",
  blockedReason = "",
  action
}: {
  subscriptionId: string;
  customerId: string;
  tenantId?: string;
  csrfToken: string;
  returnTo: string;
  defaultAmountPesos?: number;
  notificationTemplates?: any[];
  notificationRules?: any[];
  paymentType?: "LINK" | "SUBSCRIPTION";
  blockedReason?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const notificationsConfig = {
    templates: Array.isArray(notificationTemplates) ? notificationTemplates : [],
    rules: Array.isArray(notificationRules) ? notificationRules : []
  };

  function resolveNotificationTemplate(trigger: string, paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK") {
    const rules = Array.isArray(notificationsConfig?.rules) ? notificationsConfig.rules : [];
    const templates = Array.isArray(notificationsConfig?.templates) ? notificationsConfig.templates : [];
    const candidates = rules.filter((r: any) => r?.enabled && String(r?.trigger || "") === trigger);
    const filtered = paymentType
      ? candidates.filter((r: any) => {
          const types = r?.conditions?.requirePaymentTypeIn;
          if (!Array.isArray(types) || !types.length) return true;
          return types.includes(paymentType);
        })
      : candidates;
    const rule = filtered[0] || candidates[0] || null;
    if (!rule) return null;
    const template = templates.find((t: any) => String(t?.id || "") === String(rule?.templateId || ""));
    return template || null;
  }

  const paymentLinkTemplate = resolveNotificationTemplate("PAYMENT_LINK_CREATED", paymentType);
  const hasTemplate = isNotificationTemplateConfigured(paymentLinkTemplate);
  const canSend = hasTemplate && !blockedReason;
  const templateHint =
    paymentType === "SUBSCRIPTION"
      ? "Se enviará usando la plantilla WhatsApp activa de Notificaciones para link de pago de suscripción."
      : "Se enviará usando la plantilla WhatsApp activa de Notificaciones para link de pago.";
  const missingTemplateText =
    paymentType === "SUBSCRIPTION"
      ? "Falta una plantilla WhatsApp activa para link de pago de suscripción en Notificaciones. Configúrala antes de enviar."
      : "Falta una plantilla WhatsApp activa para link de pago en Notificaciones. Configúrala antes de enviar.";

  useEffect(() => {
    if (!open) return;
    setTimeout(() => amountRef.current?.focus(), 0);
  }, [open]);

  return (
    <>
      <button className="ghost btn-compact btn-pay contact-action-btn action-payment" type="button" onClick={() => setOpen(true)} data-modal="true" data-loader="off">
        Enviar link de pago
      </button>
      {open ? (
        <AppModal open={open} onClose={() => setOpen(false)} title="Enviar link de pago" maxWidth={520}>
          <>
            <form action={action} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span>Monto (COP)</span>
                  <HelpTip text="Deja vacío para usar el monto configurado en la suscripción." />
                </label>
                <input
                  ref={amountRef}
                  className="input"
                  name="amountPesos"
                  inputMode="numeric"
                  placeholder={defaultAmountPesos ? `${defaultAmountPesos}` : "Ej: 390000"}
                  defaultValue={defaultAmountPesos ? String(defaultAmountPesos) : ""}
                />
              </div>
              <div className="field">
                <label>Notificación configurada</label>
                <textarea className="input" rows={6} readOnly value={renderNotificationTemplatePreview(paymentLinkTemplate)} />
                <div className="field-hint">{templateHint}</div>
              </div>
              <label className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="sendNow" value="1" defaultChecked={canSend} disabled={!canSend} />
                <span>Enviar por WhatsApp al crear (Notificaciones)</span>
              </label>
              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  onClick={() => setOpen(false)} 
                  data-loader="off"
                  title="Cerrar sin crear"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit" 
                  pendingText="Enviando..." 
                  title="Enviar link de pago"
                  aria-label="Enviar link"
                  disabled={!canSend}
                >
                  Enviar link
                </PendingButton>
              </div>
              {!hasTemplate ? (
                <div className="field-hint ui-alert-warn">
                  {missingTemplateText}
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/settings?tab=notificaciones-whatsapp&env=PRODUCTION">
                      Configurar plantilla
                    </a>
                  </div>
                </div>
              ) : null}
              {blockedReason ? (
                <div className="field-hint ui-alert-warn">{blockedReason}</div>
              ) : null}
            </form>
          </>
        </AppModal>
      ) : null}
    </>
  );
}
