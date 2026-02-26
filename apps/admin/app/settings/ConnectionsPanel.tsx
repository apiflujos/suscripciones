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
  commsActiveEnv,
  shopify,
  actions,
  inlineState,
  initialOpen,
  returnTo
}: {
  csrfToken: string;
  wompiActiveEnv: "PRODUCTION" | "SANDBOX";
  wompiProduction: any;
  wompiSandbox: any;
  commsProduction: any;
  commsSandbox: any;
  commsActiveEnv: "PRODUCTION" | "SANDBOX";
  shopify: any;
  actions: {
    setWompiActiveEnv: (formData: FormData) => void;
    updateWompi: (formData: FormData) => void;
    testWompiConnection: (formData: FormData) => void;
    deleteWompiConnection: (formData: FormData) => void;
    updateChatwoot: (formData: FormData) => void;
    setCentralActiveEnv: (formData: FormData) => void;
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
  returnTo?: string;
}) {
  const initial = initialOpen === "wompi" || initialOpen === "central" || initialOpen === "shopify" ? initialOpen : null;
  const [open, setOpen] = useState<null | "wompi" | "central" | "shopify">(initial);
  const [syncState, setSyncState] = useState<{
    running: boolean;
    synced: number;
    failed: number;
    limit: number;
    errors: Array<{ customerId: string; error: string }>;
    error?: string;
    lastAt?: string;
  }>({ running: false, synced: 0, failed: 0, limit: 0, errors: [] });

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
          <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
            <span>{wompiActiveEnv === "PRODUCTION" ? "Producción" : "Sandbox"}</span>
            {(() => {
              const env = wompiActiveEnv === "PRODUCTION" ? wompiProduction : wompiSandbox;
              const ready = Boolean(env?.publicKey && env?.apiBaseUrl);
              return ready ? <span className="pill pill-ok pill-sm">Listo</span> : null;
            })()}
          </div>
        </button>

        <button className="conn-card" type="button" onClick={() => setOpen("central")}>
          <div className="conn-icon conn-icon-apiflujos">
            <img src="/brand/conn-apiflujos.png" alt="Apiflujos" />
          </div>
          <div className="conn-body">
            <div className="conn-title">Central</div>
            <div className="conn-sub">Comunicaciones</div>
          </div>
          <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
            <span>
              {commsActiveEnv === "PRODUCTION" ? "Producción" : "Sandbox"} ·{" "}
              {commsActiveEnv === "PRODUCTION" ? (commsProduction?.baseUrl ? "OK" : "Sin configurar") : (commsSandbox?.baseUrl ? "OK" : "Sin configurar")}
            </span>
            {(() => {
              const env = commsActiveEnv === "PRODUCTION" ? commsProduction : commsSandbox;
              const ready = Boolean(env?.baseUrl);
              return ready ? <span className="pill pill-ok pill-sm">Listo</span> : null;
            })()}
          </div>
        </button>

        <button className="conn-card" type="button" onClick={() => setOpen("shopify")}>
          <div className="conn-icon conn-icon-shopify">
            <img src="/brand/conn-shopify.png" alt="Shopify" />
          </div>
          <div className="conn-body">
            <div className="conn-title">Shopify</div>
            <div className="conn-sub">Reenvío de eventos</div>
          </div>
          <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
            <span>{shopify?.forwardUrl ? "Configurada" : "Sin configurar"}</span>
            {shopify?.forwardUrl ? <span className="pill pill-ok pill-sm">Listo</span> : null}
          </div>
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
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
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
                    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
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

              <form action={actions.setCentralActiveEnv} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "end", gap: 10 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <div className="field">
                <label>
                  Entorno activo
                  <HelpTip text="Define qué entorno usa el sistema para comunicaciones por defecto." />
                </label>
                <select className="select" name="activeEnv" defaultValue={commsActiveEnv}>
                  <option value="PRODUCTION">Producción</option>
                  <option value="SANDBOX">Sandbox</option>
                </select>
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                {inlineMsg("central_env", "Guardado.", "Error guardando", inlineState)}
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar
                </PendingButton>
              </div>
            </form>

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
                    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
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
                        <input className="input" name="apiAccessToken" type="password" placeholder="••••••••" />
                        <div className="field-hint">Déjalo vacío para conservar el token actual.</div>
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
                {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                {inlineMsg("central_bootstrap", "Atributos creados.", "Error creando", inlineState)}
                <PendingButton className="ghost" type="submit" pendingText="Creando...">
                  Crear atributos de contacto
                </PendingButton>
              </form>
              <div className="saved-conn-card" style={{ borderStyle: "dashed" }}>
                <div className="saved-conn-header">
                  <div>
                    <strong>Sincronización masiva</strong>
                    <div className="saved-conn-sub">Contactos y atributos en Central</div>
                  </div>
                </div>
                <div className="saved-conn-actions">
                  <div className="field" style={{ flex: 1, minWidth: 140 }}>
                    <label>Límite</label>
                    <input className="input" id="centralSyncLimit" placeholder="200" defaultValue="200" />
                  </div>
                  <button
                    className="ghost"
                    type="button"
                    disabled={syncState.running}
                    onClick={async () => {
                      const input = document.getElementById("centralSyncLimit") as HTMLInputElement | null;
                      const limit = Number(input?.value || 200);
                      setSyncState({ running: true, synced: 0, failed: 0, limit: Number.isFinite(limit) ? limit : 200, errors: [] });
                      try {
                        const res = await fetch("/api/comms/sync-contacts", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ limit: Number.isFinite(limit) ? limit : 200 })
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok) throw new Error(json?.error || "sync_failed");
                        setSyncState({
                          running: false,
                          synced: Number(json?.synced || 0),
                          failed: Number(json?.failed || 0),
                          limit: Number(json?.limit || limit || 0),
                          errors: Array.isArray(json?.errors) ? json.errors : [],
                          lastAt: new Date().toISOString()
                        });
                      } catch (err: any) {
                        setSyncState({
                          running: false,
                          synced: 0,
                          failed: 0,
                          limit: Number.isFinite(limit) ? limit : 200,
                          errors: [],
                          error: String(err?.message || "sync_failed"),
                          lastAt: new Date().toISOString()
                        });
                      }
                    }}
                  >
                    {syncState.running ? "Sincronizando..." : "Sincronizar"}
                  </button>
                </div>
                <div className="progress-row">
                  <div className="progress-bar">
                    <span
                      className="progress-fill"
                      style={{
                        width: syncState.limit ? `${Math.min(100, Math.round((syncState.synced / syncState.limit) * 100))}%` : "0%"
                      }}
                    />
                  </div>
                  <div className="progress-meta">
                    <span>{syncState.synced} ok · {syncState.failed} fallidos · {syncState.limit || 0} total</span>
                    {syncState.lastAt ? <span>Última: {new Date(syncState.lastAt).toLocaleString()}</span> : null}
                  </div>
                  {syncState.errors.length ? (
                    <div className="field-hint">
                      Errores recientes: {syncState.errors.map((e) => `${e.customerId.slice(0, 6)}…`).join(", ")}
                    </div>
                  ) : null}
                  {syncState.error ? (
                    <div className="field-hint" style={{ color: "var(--danger)" }}>
                      Error: {syncState.error}
                    </div>
                  ) : null}
                </div>
              </div>
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
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
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
                <input className="input" name="forwardSecret" type="password" placeholder="••••••••" />
                <div className="field-hint">Déjalo vacío para conservar el secreto actual.</div>
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
