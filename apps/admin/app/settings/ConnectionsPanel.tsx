"use client";

import { useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { DualActionButtons } from "../ui/DualActionButtons";

type InlineMsgProps = { action: string; status: string; errorText: string };

function inlineMsg(actionKey: string, okText: string, failPrefix: string, props: InlineMsgProps) {
  if (props.action !== actionKey) return null;
  if (props.status === "ok") return <div className="field-hint">{okText}</div>;
  if (props.status === "fail") return <div className="field-hint" style={{ color: "var(--danger)" }}>{failPrefix}: {props.errorText || "unknown_error"}</div>;
  return null;
}

export function ConnectionsPanel({
  csrfToken,
  wompiActiveEnv,
  wompiProduction,
  wompiSandbox,
  commsProduction,
  commsSandbox,
  shopify,
  actions,
  inlineState,
  initialOpen
}: {
  csrfToken: string;
  wompiActiveEnv: "PRODUCTION" | "SANDBOX";
  wompiProduction: any;
  wompiSandbox: any;
  commsProduction: any;
  commsSandbox: any;
  shopify: any;
  actions: {
    setWompiActiveEnv: (formData: FormData) => void;
    updateWompi: (formData: FormData) => void;
    testWompiConnection: (formData: FormData) => void;
    deleteWompiConnection: (formData: FormData) => void;
    updateChatwoot: (formData: FormData) => void;
    deleteCentralConnection: (formData: FormData) => void;
    testCentralConnection: (formData: FormData) => void;
    bootstrapCentralAttributes: (formData: FormData) => void;
    syncCentralAttributes: (formData: FormData) => void;
    updateShopify: (formData: FormData) => void;
    deleteShopifyConnection: (formData: FormData) => void;
    testShopifyForward: (formData: FormData) => void;
  };
  inlineState: InlineMsgProps;
  initialOpen?: string;
}) {
  const initial = initialOpen === "wompi" || initialOpen === "central" || initialOpen === "shopify" ? initialOpen : null;
  const [open, setOpen] = useState<null | "wompi" | "central" | "shopify">(initial);

  return (
    <>
      <div className="conn-grid">
        <button className="conn-card" type="button" onClick={() => setOpen("wompi")}>
          <div className="conn-icon conn-icon-wompi">
            <img src="/brand/conn-wompi.png" alt="Wompi" />
          </div>
          <div className="conn-body">
            <div className="conn-title">Wompi</div>
            <div className="conn-sub">Pagos y tokenización</div>
          </div>
          <div className="conn-status">{wompiActiveEnv === "PRODUCTION" ? "Producción" : "Sandbox"}</div>
        </button>

        <button className="conn-card" type="button" onClick={() => setOpen("central")}>
          <div className="conn-icon conn-icon-apiflujos">
            <img src="/brand/conn-apiflujos.png" alt="Apiflujos" />
          </div>
          <div className="conn-body">
            <div className="conn-title">Central</div>
            <div className="conn-sub">Comunicaciones</div>
          </div>
          <div className="conn-status">{commsProduction?.baseUrl ? "Configurada" : "Sin configurar"}</div>
        </button>

        <button className="conn-card" type="button" onClick={() => setOpen("shopify")}>
          <div className="conn-icon conn-icon-shopify">
            <img src="/brand/conn-shopify.png" alt="Shopify" />
          </div>
          <div className="conn-body">
            <div className="conn-title">Shopify</div>
            <div className="conn-sub">Reenvío de eventos</div>
          </div>
          <div className="conn-status">{shopify?.forwardUrl ? "Configurada" : "Sin configurar"}</div>
        </button>
      </div>

      {open === "wompi" ? (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Wompi</h3>
              <button type="button" className="ghost" onClick={() => setOpen(null)} aria-label="Cerrar">X</button>
            </div>

            <form action={actions.setWompiActiveEnv} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "end", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <div className="field">
                <label>
                  Entorno activo
                  <HelpTip text="Define qué entorno usa el sistema para operaciones por defecto." />
                </label>
                <select className="select" name="activeEnv" defaultValue={wompiActiveEnv}>
                  <option value="PRODUCTION">Producción</option>
                  <option value="SANDBOX">Sandbox</option>
                </select>
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                {inlineMsg("wompi_env", "Guardado.", "Error guardando", inlineState)}
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar
                </PendingButton>
              </div>
            </form>

            <div className="modal-split">
              {([
                ["PRODUCTION", "Producción"],
                ["SANDBOX", "Sandbox"]
              ] as const).map(([envKey, envLabel]) => (
                <div key={envKey} className="panel module">
                  <div className="panelHeaderRow">
                    <strong>Nueva conexión ({envLabel})</strong>
                  </div>
                  <form action={actions.updateWompi} style={{ display: "grid", gap: 10 }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="environment" value={envKey} />
                    <div className="field">
                      <label>Llave pública</label>
                      <input className="input" name="publicKey" placeholder="pub_..." defaultValue={(envKey === "PRODUCTION" ? wompiProduction : wompiSandbox)?.publicKey || ""} />
                    </div>
                    <div className="field">
                      <label>Llave privada</label>
                      <input className="input" name="privateKey" type="password" />
                    </div>
                    <div className="field">
                      <label>Secreto de integridad</label>
                      <input className="input" name="integritySecret" type="password" />
                    </div>
                    <div className="field">
                      <label>Secreto de eventos</label>
                      <input className="input" name="eventsSecret" type="password" />
                    </div>
                    <div className="field">
                      <label>URL base del API</label>
                      <input
                        className="input"
                        name="apiBaseUrl"
                        placeholder={envKey === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1"}
                        defaultValue={(envKey === "PRODUCTION" ? wompiProduction : wompiSandbox)?.apiBaseUrl || ""}
                      />
                    </div>
                    <div className="field">
                      <label>URL base de links de pago</label>
                      <input
                        className="input"
                        name="checkoutLinkBaseUrl"
                        placeholder="https://checkout.wompi.co/l/"
                        defaultValue={(envKey === "PRODUCTION" ? wompiProduction : wompiSandbox)?.checkoutLinkBaseUrl || ""}
                      />
                    </div>
                    <div className="field">
                      <label>URL de redirección (opcional)</label>
                      <input className="input" name="redirectUrl" defaultValue={(envKey === "PRODUCTION" ? wompiProduction : wompiSandbox)?.redirectUrl || ""} />
                    </div>
                    <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {inlineMsg("wompi_delete", "Eliminado.", "Error eliminando", inlineState)}
                        <button className="ghost" type="submit" formAction={actions.deleteWompiConnection}>
                          Eliminar conexión
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {inlineMsg("wompi_creds", "Guardado.", "Error guardando", inlineState)}
                        {inlineMsg("wompi_test", "Conexión exitosa.", "Error conectando", inlineState)}
                        <DualActionButtons
                          primaryLabel="Guardar"
                          primaryPendingLabel="Guardando..."
                          primaryClassName="primary"
                          secondaryLabel="Probar conexión"
                          secondaryPendingLabel="Conectando..."
                          secondaryClassName="ghost"
                          secondaryFormAction={actions.testWompiConnection}
                        />
                      </div>
                    </div>
                  </form>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {open === "central" ? (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Central de Comunicaciones</h3>
              <button type="button" className="ghost" onClick={() => setOpen(null)} aria-label="Cerrar">X</button>
            </div>

            <div className="modal-split">
              {([
                ["PRODUCTION", "Producción", commsProduction],
                ["SANDBOX", "Sandbox", commsSandbox]
              ] as const).map(([envKey, envLabel, comms]) => (
                <div key={envKey} className="panel module">
                  <div className="panelHeaderRow">
                    <strong>Central ({envLabel})</strong>
                  </div>
                  <form action={actions.updateChatwoot} style={{ display: "grid", gap: 10 }}>
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="environment" value={envKey} />
                    <div className="field">
                      <label>URL base</label>
                      <input className="input" name="baseUrl" placeholder="https://central.tu-dominio.com" defaultValue={comms?.baseUrl || ""} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div className="field">
                        <label>ID de cuenta</label>
                        <input className="input" name="accountId" defaultValue={comms?.accountId || ""} />
                      </div>
                      <div className="field">
                        <label>ID de bandeja</label>
                        <input className="input" name="inboxId" defaultValue={comms?.inboxId || ""} />
                      </div>
                      <div className="field">
                        <label>Token API</label>
                        <input className="input" name="apiAccessToken" type="password" defaultValue={comms?.apiAccessToken || ""} />
                      </div>
                    </div>
                    <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {inlineMsg("central_delete", "Eliminado.", "Error eliminando", inlineState)}
                        <button className="ghost" type="submit" formAction={actions.deleteCentralConnection}>
                          Eliminar conexión
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {inlineMsg("central_save", "Guardado.", "Error guardando", inlineState)}
                        {inlineMsg("central_test", "Conexión exitosa.", "Error conectando", inlineState)}
                        <DualActionButtons
                          primaryLabel="Guardar"
                          primaryPendingLabel="Guardando..."
                          primaryClassName="primary"
                          secondaryLabel="Probar conexión"
                          secondaryPendingLabel="Conectando..."
                          secondaryClassName="ghost"
                          secondaryFormAction={actions.testCentralConnection}
                        />
                      </div>
                    </div>
                  </form>
                </div>
              ))}
            </div>

            <div className="panel module" style={{ display: "grid", gap: 10 }}>
              <div className="panelHeaderRow">
                <strong>Acciones rápidas</strong>
              </div>
              <form action={actions.bootstrapCentralAttributes}>
                <input type="hidden" name="csrf" value={csrfToken} />
                {inlineMsg("central_bootstrap", "Atributos creados.", "Error creando", inlineState)}
                <PendingButton className="ghost" type="submit" pendingText="Creando...">
                  Crear atributos de contacto
                </PendingButton>
              </form>
              <form action={actions.syncCentralAttributes} style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <div className="field" style={{ flex: 1 }}>
                  <label>Límite a sincronizar</label>
                  <input className="input" name="limit" placeholder="200" />
                </div>
                {inlineMsg("central_sync", "Sincronización iniciada.", "Error sincronizando", inlineState)}
                <PendingButton className="ghost" type="submit" pendingText="Sincronizando...">
                  Sincronizar contactos
                </PendingButton>
              </form>
              <div className="field-hint">Sincroniza atributos de pagos y suscripciones con la Central de Comunicaciones Apiflujos.</div>
            </div>
          </div>
        </div>
      ) : null}

      {open === "shopify" ? (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Shopify</h3>
              <button type="button" className="ghost" onClick={() => setOpen(null)} aria-label="Cerrar">X</button>
            </div>

            <form action={actions.updateShopify} className="panel module" style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <div className="field">
                <label>URL de reenvío</label>
                <input className="input" name="forwardUrl" defaultValue={shopify?.forwardUrl || ""} />
              </div>
              <div className="field">
                <label>Origin</label>
                <select className="select" name="forwardOrigin" defaultValue={shopify?.forwardOrigin || "shopify"}>
                  <option value="shopify">shopify</option>
                  <option value="shopify-native">shopify-native</option>
                </select>
                <div className="field-hint">El servicio de Shopify acepta solo estos valores.</div>
              </div>
              <div className="field">
                <label>Secreto de reenvío (opcional)</label>
                <input className="input" name="forwardSecret" type="password" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Reintento automático</label>
                  <select className="select" name="forwardRetryEnabled" defaultValue={String(shopify?.forwardRetryEnabled ?? true)}>
                    <option value="true">Activo</option>
                    <option value="false">Desactivado</option>
                  </select>
                </div>
                <div className="field">
                  <label>Intervalo (min)</label>
                  <input className="input" name="forwardRetryMinutes" placeholder="15" defaultValue={String(shopify?.forwardRetryMinutes ?? 15)} />
                </div>
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {inlineMsg("shopify_delete", "Eliminado.", "Error eliminando", inlineState)}
                  <button className="ghost" type="submit" formAction={actions.deleteShopifyConnection}>
                    Eliminar conexión
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {inlineMsg("shopify_save", "Guardado.", "Error guardando", inlineState)}
                  {inlineMsg("shopify_test", "Forward OK.", "Error probando", inlineState)}
                  <DualActionButtons
                    primaryLabel="Guardar"
                    primaryPendingLabel="Guardando..."
                    primaryClassName="primary"
                    secondaryLabel="Probar forward"
                    secondaryPendingLabel="Probando..."
                    secondaryClassName="ghost"
                    secondaryFormAction={actions.testShopifyForward}
                  />
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
