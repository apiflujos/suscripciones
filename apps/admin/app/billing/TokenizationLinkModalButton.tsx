"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";
import { AppModal } from "../ui/AppModal";
import { isNotificationTemplateConfigured, renderNotificationTemplatePreview, resolveNotificationTemplateForTrigger } from "../lib/notificationTemplate";

export function TokenizationLinkModalButton({
  customerId,
  productId,
  planId,
  tenantId,
  csrfToken,
  returnTo,
  notificationTemplates,
  notificationRules,
  blockedReason = "",
  action
}: {
  customerId: string;
  productId?: string | null;
  planId?: string | null;
  tenantId?: string;
  csrfToken: string;
  returnTo: string;
  notificationTemplates?: any[];
  notificationRules?: any[];
  blockedReason?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const notificationsConfig = {
    templates: Array.isArray(notificationTemplates) ? notificationTemplates : [],
    rules: Array.isArray(notificationRules) ? notificationRules : []
  };

  const tokenTemplate = resolveNotificationTemplateForTrigger({
    rules: notificationsConfig.rules,
    templates: notificationsConfig.templates,
    trigger: "TOKENIZATION_LINK_CREATED"
  });
  const hasTemplate = isNotificationTemplateConfigured(tokenTemplate);
  const canSend = hasTemplate && !blockedReason;
  const disabledReason = !hasTemplate
    ? "Falta una plantilla WhatsApp activa para débito automático en Notificaciones."
    : blockedReason;

  return (
    <>
      <button
        className="ghost btn-compact btn-token contact-action-btn action-token"
        type="button"
        onClick={() => setOpen(true)}
        data-modal="true"
        data-loader="off"
        title={disabledReason || "Enviar tokenización"}
      >
        Enviar tokenización
      </button>
      {open ? (
        <AppModal open={open} onClose={() => setOpen(false)} title="Enviar link de tokenización" maxWidth={520}>
          <>
            <form action={action} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="customerId" value={customerId} />
              {productId ? <input type="hidden" name="productId" value={productId} /> : null}
              {planId ? <input type="hidden" name="planId" value={planId} /> : null}
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              <div className="field">
                <label>Notificación configurada</label>
                <textarea className="input" rows={6} readOnly value={renderNotificationTemplatePreview(tokenTemplate)} />
                <div className="field-hint">Se enviará usando la plantilla WhatsApp activa de Notificaciones para débito automático.</div>
              </div>
              <div className="module-footer">
                <button 
                  className="ghost btn-compact btn-cancel" 
                  type="button" 
                  onClick={() => setOpen(false)} 
                  data-loader="off"
                  title="Cerrar sin enviar"
                  aria-label="Cancelar"
                >
                  Cancelar
                </button>
                <PendingButton 
                  className="primary btn-compact btn-save" 
                  type="submit" 
                  pendingText="Enviando..." 
                  title="Enviar link de tokenización"
                  aria-label="Enviar link"
                  disabled={!canSend}
                >
                  Enviar tokenización
                </PendingButton>
              </div>
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
