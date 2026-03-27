"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";

export function TokenizationLinkModalButton({
  customerId,
  planId,
  tenantId,
  csrfToken,
  returnTo,
  notificationTemplates,
  notificationRules,
  action
}: {
  customerId: string;
  planId?: string | null;
  tenantId?: string;
  csrfToken: string;
  returnTo: string;
  notificationTemplates?: any[];
  notificationRules?: any[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const notificationsConfig = {
    templates: Array.isArray(notificationTemplates) ? notificationTemplates : [],
    rules: Array.isArray(notificationRules) ? notificationRules : []
  };

  function resolveNotificationTemplate(trigger: string) {
    const rules = Array.isArray(notificationsConfig?.rules) ? notificationsConfig.rules : [];
    const templates = Array.isArray(notificationsConfig?.templates) ? notificationsConfig.templates : [];
    const candidates = rules.filter((r: any) => r?.enabled && String(r?.trigger || "") === trigger);
    const rule = candidates[0] || null;
    if (!rule) return null;
    const template = templates.find((t: any) => String(t?.id || "") === String(rule?.templateId || ""));
    return template || null;
  }

  function renderNotificationPreview(template: any) {
    if (!template) return "No hay plantilla configurada en Notificaciones.";
    if (template?.content && String(template.content || "").trim() && String(template.content || "") !== "(template)") {
      return String(template.content || "").trim();
    }
    const name = String(template?.chatwootTemplate?.name || "").trim();
    const lang = String(template?.chatwootTemplate?.language || "").trim();
    const params = template?.chatwootTemplate?.processed_params?.body || [];
    if (!name) return "Plantilla configurada en CentralCom.";
    const paramText = Array.isArray(params) && params.length ? params.map((p: any) => String(p?.value || "")).join(" | ") : "—";
    return `Plantilla WhatsApp: ${name}${lang ? ` (${lang})` : ""}\nParámetros: ${paramText}`;
  }

  const tokenTemplate = resolveNotificationTemplate("TOKENIZATION_LINK_CREATED");
  const canSend = Boolean(tokenTemplate);

  return (
    <>
      <button className="ghost btn-compact btn-send btn-highlight" type="button" onClick={() => setOpen(true)} data-modal="true" data-loader="off">
        Enviar link
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 520 }}>
            <div className="panel-header ui-panel-header">
              <strong>Enviar link de tokenización</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form action={action} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="customerId" value={customerId} />
              {planId ? <input type="hidden" name="planId" value={planId} /> : null}
              <input type="hidden" name="returnTo" value={returnTo} />
              {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
              <div className="field">
                <label>Notificación configurada</label>
                <textarea className="input" rows={6} readOnly value={renderNotificationPreview(tokenTemplate)} />
                <div className="field-hint">Se enviará usando las reglas activas de Notificaciones (tokenización).</div>
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
                  disabled={!canSend}
                  title="Enviar link de tokenización"
                  aria-label="Enviar link"
                >
                  Enviar link
                </PendingButton>
              </div>
              {!canSend ? (
                <div className="field-hint ui-alert-danger">
                  No hay plantilla activa para tokenización en Notificaciones.
                  <div style={{ marginTop: 6 }}>
                    <a className="ghost btn-compact" href="/notifications?env=PRODUCTION&open=tokenization_link_created">
                      Configurar plantilla
                    </a>
                  </div>
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
