import { WebhookProvider } from "@prisma/client";
import { CopyButton } from "../ui/CopyButton";
import { generateWebhookSecret } from "@suscripciones/core/services/webhookSecrets";
import { PendingButton } from "../ui/PendingButton";

type WebhookEndpointRow = {
  id: string;
  name: string;
  provider: WebhookProvider;
  path: string;
  active: boolean;
  createdAt: Date;
};

type ApiTokenRow = {
  id: string;
  name: string;
  permissions: string[];
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

export function WebhooksPanel({
  csrfToken,
  baseUrl,
  wompiUrl,
  wompiActiveEnv,
  wompiEventsSecretMasked,
  endpoints,
  apiTokens,
  docsUrl,
  swaggerUrl,
  openId,
  createdToken,
  inlineState,
  actions,
  returnTo
}: {
  csrfToken: string;
  baseUrl: string;
  wompiUrl: string;
  wompiActiveEnv: "PRODUCTION" | "SANDBOX";
  wompiEventsSecretMasked: string;
  endpoints: WebhookEndpointRow[];
  apiTokens: ApiTokenRow[];
  docsUrl: string;
  swaggerUrl: string;
  openId: string | null;
  createdToken: string;
  inlineState: { action: string; status: string; errorText: string };
  actions: {
    createWebhookEndpointAction: (formData: FormData) => void;
    updateWebhookEndpointAction: (formData: FormData) => void;
    deleteWebhookEndpointAction: (formData: FormData) => void;
    createApiTokenAction: (formData: FormData) => void;
    revokeApiTokenAction: (formData: FormData) => void;
  };
  returnTo: string;
}) {
  const suggestedSecret = generateWebhookSecret();
  const openEndpoint = openId && openId !== "new" ? endpoints.find((e) => e.id === openId) || null : null;
  const isNew = openId === "new";
  const tokenValue = String(createdToken || "").trim();
  const apiTokenScope = (perms: string[]) => (perms || []).some((p) => p.endsWith(":write")) ? "Lectura y escritura" : "Solo lectura";

  const inlineMsg = (actionKey: string, okText: string, failPrefix: string) => {
    if (inlineState.action !== actionKey) return null;
    if (inlineState.status === "ok") return <div className="field-hint is-success">{okText}</div>;
    if (inlineState.status === "fail") return <div className="field-hint" style={{ color: "var(--danger)" }}>{failPrefix}: {inlineState.errorText || "unknown_error"}</div>;
    return null;
  };

  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <div className="panelHeaderRow">
          <div style={{ display: "grid", gap: 4 }}>
            <h3>Integraciones</h3>
            <div className="field-hint">Webhooks, tokens y documentación para integrar pasarelas y sistemas externos.</div>
          </div>
        </div>
      </div>
      <div className="settings-group-body" style={{ display: "grid", gap: 12 }}>
        <div className="panel module">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 8 }}>
            <strong>Documentación API</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {docsUrl ? (
                <a className="ghost btn-compact btn-blue" href={docsUrl} target="_blank" rel="noreferrer">
                  Docs
                </a>
              ) : null}
              {swaggerUrl ? (
                <a className="ghost btn-compact" href={swaggerUrl} target="_blank" rel="noreferrer">
                  Swagger
                </a>
              ) : null}
            </div>
          </div>
          <div className="field-hint">
            {docsUrl || swaggerUrl
              ? "Acceso directo a la documentación técnica y especificación OpenAPI."
              : "Configura `API_DOCS_URL` o `API_SWAGGER_URL` para mostrar los accesos."}
          </div>
        </div>

        <div className="panel module">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 8 }}>
            <strong>Wompi</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CopyButton text={wompiUrl} label="Copiar URL" />
              <a className="ghost btn-compact btn-blue" href={`/settings?tab=connections&open=wompi_${wompiActiveEnv === "SANDBOX" ? "sandbox" : "prod"}`}>
                Editar credenciales
              </a>
            </div>
          </div>
          <div className="field-hint">URL:</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <code className="mono" style={{ padding: "6px 8px", border: "1px solid var(--stroke)", borderRadius: 8, background: "var(--panel)" }}>
              {wompiUrl || "Configura APP_PUBLIC_BASE_URL"}
            </code>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Secreto de eventos ({wompiActiveEnv === "SANDBOX" ? "Sandbox" : "Producción"}): {wompiEventsSecretMasked || "—"}
          </div>
        </div>

        <div className="panel module">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 8 }}>
            <strong>Tokens API</strong>
          </div>
          <div className="field-hint">Genera tokens para leer o escribir datos desde sistemas externos.</div>

          {inlineMsg("api_token_create", "Token generado.", "Error generando")}
          {inlineMsg("api_token_revoke", "Token revocado.", "Error revocando")}

          {tokenValue ? (
            <div className="card cardPad" style={{ marginTop: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <strong>Token generado (cópialo ahora)</strong>
                <code className="mono" style={{ padding: "8px 10px", border: "1px solid var(--stroke)", borderRadius: 8, background: "var(--panel)" }}>
                  {tokenValue}
                </code>
                <div style={{ display: "flex", gap: 8 }}>
                  <CopyButton text={tokenValue} label="Copiar token" />
                  <a className="ghost btn-compact" href="/settings?tab=integraciones">Ocultar</a>
                </div>
              </div>
            </div>
          ) : null}

          <form action={actions.createApiTokenAction} className="panel module" style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="field">
              <label>Nombre</label>
              <input className="input" name="name" placeholder="Ej: Integración ERP" />
            </div>
            <div className="field">
              <label>Permisos</label>
              <select className="select" name="scope" defaultValue="read">
                <option value="read">Solo lectura</option>
                <option value="write">Lectura y escritura</option>
              </select>
            </div>
            <div className="field">
              <label>Vigencia</label>
              <select className="select" name="ttlHours" defaultValue="720">
                <option value="24">24 horas</option>
                <option value="168">7 días</option>
                <option value="720">30 días</option>
                <option value="2160">90 días</option>
                <option value="8760">365 días</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <PendingButton className="btn btn-primary" type="submit">Generar token</PendingButton>
            </div>
          </form>

          {apiTokens.length ? (
            <div className="saved-connections-grid" style={{ marginTop: 10 }}>
              {apiTokens.map((t) => (
                <div className="saved-conn-card" key={t.id}>
                  <div className="saved-conn-header">
                    <div>
                      <div className="saved-conn-title">{t.name}</div>
                      <div className="saved-conn-sub">{apiTokenScope(t.permissions)}</div>
                    </div>
                    <span className={`pill ${t.revokedAt ? "pill-bad" : "pill-green"}`}>{t.revokedAt ? "Revocado" : "Activo"}</span>
                  </div>
                  <div className="saved-conn-meta">
                    <div className="saved-conn-meta-item">
                      <div className="saved-conn-meta-label">Expira</div>
                      <div className="saved-conn-meta-value">{new Date(t.expiresAt).toLocaleDateString("es-CO")}</div>
                    </div>
                    <div className="saved-conn-meta-item">
                      <div className="saved-conn-meta-label">Último uso</div>
                      <div className="saved-conn-meta-value">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString("es-CO") : "—"}</div>
                    </div>
                  </div>
                  <div className="saved-conn-actions">
                    {!t.revokedAt ? (
                      <form action={actions.revokeApiTokenAction}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="id" value={t.id} />
                        <PendingButton className="ghost btn-compact" type="submit">Revocar</PendingButton>
                      </form>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: 12 }}>
              <div className="empty-state-title">No hay tokens activos</div>
              <div className="empty-state-description">Genera uno para integrar tu e‑commerce o ERP.</div>
            </div>
          )}
        </div>

        <div className="panel module">
          <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 8 }}>
            <strong>Otros webhooks</strong>
            <a className="ghost btn-compact btn-blue" href="/settings?tab=integraciones&open=new">
              Nuevo webhook
            </a>
          </div>
          <div className="field-hint">
            Crea endpoints adicionales para otras pasarelas. Estos webhooks solo registran eventos hasta que se integre su procesamiento.
          </div>
          {inlineMsg("webhook_create", "Webhook creado.", "Error creando")}
          {inlineMsg("webhook_update", "Webhook actualizado.", "Error actualizando")}
          {inlineMsg("webhook_delete", "Webhook eliminado.", "Error eliminando")}

          {endpoints.length ? (
            <div className="saved-connections-grid" style={{ marginTop: 10 }}>
              {endpoints.map((e) => {
                const url = `${baseUrl}/webhooks/incoming/${e.path}`;
                return (
                  <div className="saved-conn-card" key={e.id}>
                    <div className="saved-conn-header">
                      <div>
                        <div className="saved-conn-title">{e.name}</div>
                        <div className="saved-conn-sub">{e.provider}</div>
                      </div>
                      <span className={`pill ${e.active ? "pill-green" : "pill-muted"}`}>{e.active ? "Activo" : "Inactivo"}</span>
                    </div>
                    <div className="saved-conn-meta">
                      <div className="saved-conn-meta-item">
                        <div className="saved-conn-meta-label">URL</div>
                        <div className="saved-conn-meta-value">{url}</div>
                      </div>
                      <div className="saved-conn-meta-item">
                        <div className="saved-conn-meta-label">Secreto</div>
                        <div className="saved-conn-meta-value">••••••••</div>
                      </div>
                    </div>
                    <div className="saved-conn-actions">
                      <CopyButton text={url} label="Copiar URL" />
                      <a className="ghost btn-compact" href={`/settings?tab=integraciones&open=${encodeURIComponent(e.id)}`}>
                        Editar
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: 12 }}>
              <div className="empty-state-title">No hay webhooks adicionales</div>
              <div className="empty-state-description">Crea uno para MercadoPago u otra pasarela cuando la conectes.</div>
            </div>
          )}
        </div>
      </div>

      {isNew ? (
        <div className="modal-backdrop">
          <div className="modal-panel modal-panel-fixed">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Nuevo webhook</h3>
              <a className="ghost modal-close" href="/settings?tab=integraciones" aria-label="Cerrar" data-modal-close="true">X</a>
            </div>
            <div className="modal-body">
              <form action={actions.createWebhookEndpointAction} className="panel module" style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" placeholder="Ej: MercadoPago" />
                </div>
                <div className="field">
                  <label>Proveedor</label>
                  <select className="select" name="provider" defaultValue="MERCADOPAGO">
                    <option value="CUSTOM">Custom</option>
                    <option value="MERCADOPAGO">MercadoPago</option>
                  </select>
                </div>
                <div className="field">
                  <label>Secreto</label>
                  <input className="input" name="secret" defaultValue={suggestedSecret} />
                  <div className="field-hint">Guarda este secreto en la pasarela para firmar el webhook.</div>
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="hidden" name="active" value="false" />
                    <input type="checkbox" name="active" value="true" defaultChecked />
                    Activo
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PendingButton className="btn btn-primary" type="submit">Crear</PendingButton>
                  <a className="ghost btn-compact" href="/settings?tab=integraciones">Cancelar</a>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {openEndpoint ? (
        <div className="modal-backdrop">
          <div className="modal-panel modal-panel-fixed">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Editar webhook</h3>
              <a className="ghost modal-close" href="/settings?tab=integraciones" aria-label="Cerrar" data-modal-close="true">X</a>
            </div>
            <div className="modal-body">
              <form action={actions.updateWebhookEndpointAction} className="panel module" style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="id" value={openEndpoint.id} />
                <div className="field">
                  <label>Nombre</label>
                  <input className="input" name="name" defaultValue={openEndpoint.name} />
                </div>
                <div className="field">
                  <label>Proveedor</label>
                  <select className="select" name="provider" defaultValue={openEndpoint.provider}>
                    <option value="CUSTOM">Custom</option>
                    <option value="MERCADOPAGO">MercadoPago</option>
                  </select>
                </div>
                <div className="field">
                  <label>Nuevo secreto (opcional)</label>
                  <input className="input" name="secret" placeholder="Deja vacío para mantener el actual" />
                </div>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="hidden" name="active" value="false" />
                    <input type="checkbox" name="active" value="true" defaultChecked={openEndpoint.active} />
                    Activo
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PendingButton className="btn btn-primary" type="submit">Guardar</PendingButton>
                  <a className="ghost btn-compact" href="/settings?tab=integraciones">Cancelar</a>
                </div>
              </form>
              <form action={actions.deleteWebhookEndpointAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="id" value={openEndpoint.id} />
                <PendingButton className="ghost btn-compact" type="submit">Eliminar</PendingButton>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
