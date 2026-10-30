import Link from "next/link";
import { TemplatesSyncPanel } from "./TemplatesSyncPanel";
import { CONNECTIONS_LIST_HREF, connectionHref } from "./connections/connectionMeta";
import "./settings-layout.css";

type InlineMsgProps = { action: string; status: string; errorText: string };

const DELETE_MESSAGES: Record<string, string> = {
  wompi_delete: "Conexión de Wompi",
  central_delete: "Conexión de Chatwoot",
  shopify_delete: "Conexión de Shopify"
};

/**
 * Tarjetas de conexiones. Cada una es un enlace a su propia página
 * (/settings/connections/[wompi-prod|wompi-sandbox|chatwoot|shopify]); ya no hay modales.
 */
export function ConnectionsPanel({
  wompiActiveEnv,
  wompiProduction,
  wompiSandbox,
  commsProduction,
  shopify,
  inlineState,
  returnTo = CONNECTIONS_LIST_HREF
}: {
  wompiActiveEnv: "PRODUCTION" | "SANDBOX";
  wompiProduction: any;
  wompiSandbox: any;
  commsProduction: any;
  shopify: any;
  inlineState: InlineMsgProps;
  returnTo?: string;
}) {
  const deleted = DELETE_MESSAGES[inlineState.action];
  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <div className="settings-group-header-main">
          <h3>Conexiones</h3>
          <div className="field-hint">Abre cada conexión para configurar sus credenciales.</div>
        </div>
      </div>
      <div className="settings-group-body" style={{ display: "grid", gap: 12 }}>
        {deleted && inlineState.status === "ok" ? <div className="field-hint is-success" role="status">{deleted} eliminada.</div> : null}
        {deleted && inlineState.status === "fail" ? (
          <div className="field-hint" role="alert" style={{ color: "var(--danger)" }}>
            Error eliminando: {inlineState.errorText || "unknown_error"}
          </div>
        ) : null}
          <div className="conn-grid">
            <Link className="conn-card" href={connectionHref("wompi-prod", { returnTo })} data-loader="off">
              <div className="conn-icon conn-icon-wompi">
                <img src="/brand/conn-wompi.png" alt="Wompi" />
              </div>
              <div className="conn-body">
                <div className="conn-title">Wompi · Producción</div>
                <div className="conn-sub">Pagos y débito automático</div>
              </div>
              <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                <span>{wompiActiveEnv === "PRODUCTION" ? "Activo" : "Inactivo"}</span>
                {(() => {
                  const ready = Boolean(wompiProduction?.publicKey && wompiProduction?.privateKey && wompiProduction?.integritySecret && wompiProduction?.eventsSecret);
                  return ready ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--status-success)" }}>
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--status-success)" }}>
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                      </svg>
                      Conectado
                    </span>
                  ) : (
                    <span className="muted">Sin configurar</span>
                  );
                })()}
              </div>
            </Link>

            <Link className="conn-card" href={connectionHref("wompi-sandbox", { returnTo })} data-loader="off">
              <div className="conn-icon conn-icon-wompi">
                <img src="/brand/conn-wompi.png" alt="Wompi" />
              </div>
              <div className="conn-body">
                <div className="conn-title">Wompi · Sandbox</div>
                <div className="conn-sub">Pagos y débito automático</div>
              </div>
              <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                <span>{wompiActiveEnv === "SANDBOX" ? "Activo" : "Inactivo"}</span>
                {(() => {
                  const ready = Boolean(wompiSandbox?.publicKey && wompiSandbox?.privateKey && wompiSandbox?.integritySecret && wompiSandbox?.eventsSecret);
                  return ready ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--status-success)" }}>
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--status-success)" }}>
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                      </svg>
                      Conectado
                    </span>
                  ) : (
                    <span className="muted">Sin configurar</span>
                  );
                })()}
              </div>
            </Link>

            <Link className="conn-card" href={connectionHref("chatwoot", { returnTo })} data-loader="off">
              <div className="conn-icon conn-icon-apiflujos">
                <img src="/brand/logo_vertical.svg" alt="Logo" data-theme-logo="vertical" />
              </div>
              <div className="conn-body">
                <div className="conn-title">Chatwoot · WhatsApp</div>
                <div className="conn-sub">Mensajería y plantillas</div>
              </div>
              <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                <span>{commsProduction?.baseUrl ? "Activo" : "Inactivo"}</span>
                {(() => {
                  const ready = Boolean(commsProduction?.baseUrl && commsProduction?.accountId && commsProduction?.inboxId);
                  return ready ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--status-success)" }}>
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--status-success)" }}>
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                      </svg>
                      Conectado
                    </span>
                  ) : (
                    <span className="muted">Sin configurar</span>
                  );
                })()}
              </div>
            </Link>

            <Link className="conn-card" href={connectionHref("shopify", { returnTo })} data-loader="off">
              <div className="conn-icon conn-icon-shopify">
                <img src="/brand/conn-shopify.png" alt="Shopify" />
              </div>
              <div className="conn-body">
                <div className="conn-title">Shopify</div>
                <div className="conn-sub">Reenvío de eventos</div>
              </div>
              <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                <span>{shopify?.forwardUrl ? "Activo" : "Inactivo"}</span>
                {shopify?.forwardUrl ? (
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--success)" }}>
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                  </svg>
                ) : null}
              </div>
            </Link>
          </div>
          <TemplatesSyncPanel />
      </div>
    </section>
  );
}
