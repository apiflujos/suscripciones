"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { HelpTip } from "../ui/HelpTip";
import { withReturnTo } from "../lib/returnTo";
import { buildNotificationEntries, type Env, type Rule, type Template } from "./notificationsModel";
import "./notifications.css";

/**
 * Lista de notificaciones de WhatsApp (en Ajustes). Solo lista: configurar una notificación
 * abre /notifications/[id] (antes un modal de 900 px). Cada fila trae su interruptor y un
 * enlace "Configurar".
 *
 * `returnTo` es la URL de esta lista; a ella vuelve el editor al guardar o cancelar.
 */
export function NotificationsSimple({
  env,
  csrfToken,
  templates,
  rules,
  paymentsConfig,
  actions,
  returnTo
}: {
  env: Env;
  csrfToken: string;
  templates: Template[];
  rules: Rule[];
  paymentsConfig?: { notifyWhatsappForUnlinkedPayments?: boolean | null } | null;
  actions: {
    saveRealtime?: (formData: FormData) => void;
    saveReminder?: (formData: FormData) => void;
    toggleRule: (formData: FormData) => void;
    updatePaymentsConfig: (formData: FormData) => void;
  };
  returnTo?: string;
}) {
  const router = useRouter();
  const listUrl = returnTo || `/settings?tab=notificaciones-whatsapp&env=${env}`;
  const entries = useMemo(() => buildNotificationEntries(templates, rules), [templates, rules]);

  // Enlaces antiguos (`?open=<clave>`) abrían el modal de esa notificación: ahora llevan a su página.
  useEffect(() => {
    const open = String(new URLSearchParams(window.location.search).get("open") || "").trim();
    if (open && entries.some((entry) => entry.id === open)) {
      router.replace(withReturnTo(`/notifications/${encodeURIComponent(open)}?env=${env}`, listUrl));
    }
  }, [entries, env, listUrl, router]);

  return (
    <div className="notif-config">
      <div className="settings-group-header">
        <div className="settings-group-header-main">
          <div className="notif-heading">
            <h2>Notificaciones WhatsApp</h2>
            <HelpTip text="Crea notificaciones personalizadas por evento y configura los recordatorios automáticos." />
          </div>
        </div>
      </div>

      <section className="settings-group notifications-templates-section">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <h3>Lista de notificaciones</h3>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="notif-list">
            {entries.map((item) => {
              const href = withReturnTo(`/notifications/${encodeURIComponent(item.id)}?env=${env}`, listUrl);
              return (
                <div key={item.id} className="card cardPad notif-row">
                  <div className="notif-row-main">
                    <strong>{item.label}</strong>
                    <div className="muted notif-row-sub">{item.subtitle}</div>
                  </div>
                  <div className="notif-row-controls">
                    <span className={`pill ${item.statusPill}`}>{item.statusLabel}</span>
                    {item.ruleId ? (
                      <form
                        action={actions.toggleRule}
                        onChange={(e) => {
                          const form = (e.currentTarget as HTMLFormElement) || null;
                          form?.requestSubmit();
                        }}
                        data-loader="off"
                      >
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={env} />
                        <input type="hidden" name="ruleId" value={item.ruleId} />
                        <input type="hidden" name="returnTo" value={listUrl} />
                        <input type="hidden" name="enabled" value={item.enabled ? "0" : "1"} />
                        <label className="toggleControl" aria-label={`${item.enabled ? "Apagar" : "Prender"}: ${item.label}`} data-loader="off">
                          <input className="toggleInput" type="checkbox" defaultChecked={item.enabled} data-loader="off" />
                          <span className="toggle" aria-hidden="true" />
                        </label>
                      </form>
                    ) : null}
                    <Link className="primary btn-compact" href={href} data-loader="off" aria-label={`Configurar ${item.label}`}>
                      Configurar
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="settings-group-header-main">
            <div className="notif-heading">
              <h3>Pagos externos</h3>
              <HelpTip text="Controla si se notifican pagos sin suscripción asociada." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <form
            action={actions.updatePaymentsConfig}
            className="panel module"
            style={{ display: "grid", gap: 12 }}
            onChange={(e) => {
              const form = (e.currentTarget as HTMLFormElement) || null;
              form?.requestSubmit();
            }}
            data-loader="off"
          >
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="returnTo" value="/settings?tab=notificaciones-whatsapp" />
            <div className="toggleRow">
              <div>
                <strong>Notificar pagos externos</strong>
                <div className="field-hint">Aplica a pagos sin suscripción activa o no asociados.</div>
              </div>
              <label className="toggleControl" aria-label="Notificar pagos externos">
                <input type="hidden" name="notifyWhatsappForUnlinkedPayments" value="0" />
                <input
                  className="toggleInput"
                  type="checkbox"
                  name="notifyWhatsappForUnlinkedPayments"
                  value="1"
                  defaultChecked={Boolean(paymentsConfig?.notifyWhatsappForUnlinkedPayments ?? true)}
                  data-loader="off"
                />
                <span className="toggle" aria-hidden="true" />
              </label>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
