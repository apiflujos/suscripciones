"use client";

import { useRef, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { DualActionButtons } from "../ui/DualActionButtons";

type InlineMsgProps = { action: string; status: string; errorText: string };

function inlineMsg(actionKey: string, okText: string, failPrefix: string, props: InlineMsgProps) {
  if (props.action !== actionKey) return null;
  if (props.status === "ok") return <div className="field-hint is-success">{okText}</div>;
  if (props.status === "fail") return <div className="field-hint" style={{ color: "var(--danger)" }}>{failPrefix}: {props.errorText || "unknown_error"}</div>;
  return null;
}

export function ConnectionsPanel({
  csrfToken,
  wompiActiveEnv,
  wompiProduction,
  wompiSandbox,
  commsProduction,
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
  shopify: any;
  actions: {
    setWompiActiveEnv: (formData: FormData) => void;
    updateWompi: (formData: FormData) => void;
    testWompiConnection: (formData: FormData) => Promise<void>;
    deleteWompiConnection: (formData: FormData) => void;
    updateChatwoot: (formData: FormData) => void;
    deleteCentralConnection: (formData: FormData) => void;
    testCentralConnection: (formData: FormData) => Promise<void>;
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
  const initial =
    initialOpen === "wompi_sandbox"
      ? "wompi_sandbox"
      : initialOpen === "wompi"
        ? "wompi_prod"
        : initialOpen === "wompi_prod"
          ? "wompi_prod"
          : initialOpen === "central" || initialOpen === "shopify"
            ? initialOpen
            : null;
  const [open, setOpen] = useState<null | "wompi_prod" | "wompi_sandbox" | "central" | "shopify">(initial);
  
  // Estado local para测试结果 (se mantiene después de guardar/cerrar)
  const [wompiTestStatus, setWompiTestStatus] = useState<{ PRODUCTION: "ok" | "fail" | null; SANDBOX: "ok" | "fail" | null }>({
    PRODUCTION: null,
    SANDBOX: null
  });
  const [centralTestStatus, setCentralTestStatus] = useState<"ok" | "fail" | null>(null);
  const [shopifyTestStatus, setShopifyTestStatus] = useState<"idle" | "pending" | "ok" | "fail">("idle");
  const [shopifyTestError, setShopifyTestError] = useState("");
  const shopifyFormRef = useRef<HTMLFormElement | null>(null);
  const [templatesSync, setTemplatesSync] = useState<{ running: boolean; count: number; error: string }>({ running: false, count: 0, error: "" });

  const syncWhatsappTemplates = async () => {
    setTemplatesSync({ running: true, count: 0, error: "" });
    try {
      const res = await fetch("/admin/comms?op=whatsapp_templates", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "sync_failed");
      const count = Array.isArray(json?.templates) ? json.templates.length : 0;
      setTemplatesSync({ running: false, count, error: "" });
    } catch (err: any) {
      setTemplatesSync({ running: false, count: 0, error: String(err?.message || "sync_failed") });
    }
  };

  const runShopifyTest = async () => {
    if (!shopifyFormRef.current) return;
    const formData = new FormData(shopifyFormRef.current);
    const payload = {
      forwardUrl: String(formData.get("forwardUrl") || "").trim(),
      forwardOrigin: String(formData.get("forwardOrigin") || "").trim(),
      forwardSecret: String(formData.get("forwardSecret") || "").trim()
    };
    setShopifyTestStatus("pending");
    setShopifyTestError("");
    try {
      const res = await fetch("/admin/settings/shopify/test-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setShopifyTestStatus("fail");
        setShopifyTestError(String(json?.error || json?.message || `http_${res.status}`));
        return;
      }
      setShopifyTestStatus("ok");
    } catch (err: any) {
      setShopifyTestStatus("fail");
      setShopifyTestError(String(err?.message || "request_failed"));
    }
  };

  return (
    <>
      <div className="conn-grid">
        <button className="conn-card" type="button" data-modal="true" data-loader="off" onClick={() => setOpen("wompi_prod")}>
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
              return ready && wompiActiveEnv === "PRODUCTION" ? (
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--success)" }}>
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                </svg>
              ) : null;
            })()}
          </div>
        </button>

        <button className="conn-card" type="button" data-modal="true" data-loader="off" onClick={() => setOpen("wompi_sandbox")}>
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
              return ready && wompiActiveEnv === "SANDBOX" ? (
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--success)" }}>
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                </svg>
              ) : null;
            })()}
          </div>
        </button>

        <button className="conn-card" type="button" data-modal="true" data-loader="off" onClick={() => setOpen("central")}>
          <div className="conn-icon conn-icon-apiflujos">
            <img src="/brand/logo_vertical.svg" alt="Logo" data-theme-logo="vertical" />
          </div>
          <div className="conn-body">
            <div className="conn-title">CentralCom</div>
            <div className="conn-sub">Comunicaciones</div>
          </div>
          <div className="conn-status" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
            <span>{commsProduction?.baseUrl ? "Activo" : "Inactivo"}</span>
            {(() => {
              const ready = Boolean(commsProduction?.baseUrl && commsProduction?.accountId && commsProduction?.inboxId);
              return ready ? (
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--success)" }}>
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                </svg>
              ) : null;
            })()}
          </div>
        </button>

        <button className="conn-card" type="button" data-modal="true" data-loader="off" onClick={() => setOpen("shopify")}>
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
        </button>
      </div>
      <div className="panel module" style={{ marginTop: 12 }}>
        <div className="panelHeaderRow" style={{ justifyContent: "space-between", gap: 8 }}>
          <strong>CentralCom · Plantillas WhatsApp</strong>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="ghost btn-compact" type="button" onClick={syncWhatsappTemplates} disabled={templatesSync.running} data-loader="off">
              {templatesSync.running ? "Sincronizando..." : "Sincronizar plantillas"}
            </button>
            <span className="field-hint">
              {templatesSync.count ? `Sincronizadas: ${templatesSync.count}` : "Trae las plantillas activas desde Chatwoot."}
            </span>
          </div>
        </div>
        {templatesSync.error ? (
          <div className="field-hint" style={{ color: "var(--danger)" }}>
            Error: {templatesSync.error}
          </div>
        ) : null}
      </div>

      {open === "wompi_prod" || open === "wompi_sandbox" ? (
        <div className="modal-backdrop">
          <div className="modal-panel modal-panel-fixed">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>{open === "wompi_prod" ? "Wompi · Producción" : "Wompi · Sandbox"}</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(null)} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>

            <div className="modal-body">
            <div className="panel module">
              <div className="panelHeaderRow">
                <strong>Conexión ({open === "wompi_prod" ? "Producción" : "Sandbox"})</strong>
              </div>
              <form action={actions.updateWompi} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                <input type="hidden" name="environment" value={open === "wompi_prod" ? "PRODUCTION" : "SANDBOX"} />
                <div className="field">
                  <label>Llave pública</label>
                  <input
                    className="input"
                    name="publicKey"
                    placeholder="pub_..."
                    defaultValue={(open === "wompi_prod" ? wompiProduction : wompiSandbox)?.publicKey || ""}
                  />
                </div>
                <div className="field">
                  <label>Llave privada</label>
                  <input className="input" name="privateKey" type="password" />
                </div>
                <div className="field">
                  <label>Eventos</label>
                  <input className="input" name="eventsSecret" type="password" />
                </div>
                <div className="field">
                  <label>Integridad</label>
                  <input className="input" name="integritySecret" type="password" />
                </div>
                <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {inlineMsg("wompi_delete", "Eliminado.", "Error eliminando", inlineState)}
                    <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" formAction={actions.deleteWompiConnection} aria-label="Eliminar conexión Wompi" title="Eliminar conexión Wompi" />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {inlineMsg("wompi_creds", "Guardado.", "Error guardando", inlineState)}
                    {/* Estado de prueba - se mantiene después de guardar */}
                    {wompiTestStatus[open === "wompi_prod" ? "PRODUCTION" : "SANDBOX"] === "ok" ? (
                      <div className="field-hint is-success" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>
                        <span>Conexión exitosa</span>
                      </div>
                    ) : wompiTestStatus[open === "wompi_prod" ? "PRODUCTION" : "SANDBOX"] === "fail" ? (
                      <div className="field-hint" style={{ color: "var(--danger)" }}>
                        <span>Error conectando</span>
                      </div>
                    ) : null}
                    <DualActionButtons
                      primaryLabel="Guardar"
                      primaryPendingLabel="Guardando..."
                      primaryClassName="primary"
                      secondaryLabel="Probar conexión"
                      secondaryPendingLabel="Conectando..."
                      secondaryClassName="ghost"
                      secondaryFormAction={async (formData: FormData) => {
                        try {
                          await actions.testWompiConnection(formData);
                          setWompiTestStatus(prev => ({ ...prev, [open === "wompi_prod" ? "PRODUCTION" : "SANDBOX"]: "ok" as const }));
                        } catch (err: any) {
                          setWompiTestStatus(prev => ({ ...prev, [open === "wompi_prod" ? "PRODUCTION" : "SANDBOX"]: "fail" as const }));
                        }
                      }}
                    />
                  </div>
                </div>
              </form>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {open === "central" ? (
        <div className="modal-backdrop">
          <div className="modal-panel modal-panel-fixed">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>CentralCom</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(null)} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>

            <div className="modal-body">
              <div className="panel module">
                <div className="panelHeaderRow">
                  <strong>CentralCom · Chatwoot</strong>
                </div>
                <form action={actions.updateChatwoot} style={{ display: "grid", gap: 10 }}>
                  <input type="hidden" name="csrf" value={csrfToken} />
                  {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                  <input type="hidden" name="environment" value="PRODUCTION" />
                  <div className="field">
                    <label>URL base</label>
                    <input className="input" name="baseUrl" placeholder="https://central.tu-dominio.com" defaultValue={commsProduction?.baseUrl || ""} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>ID de cuenta</label>
                      <input className="input" name="accountId" defaultValue={commsProduction?.accountId || ""} />
                    </div>
                    <div className="field">
                      <label>ID de bandeja</label>
                      <input className="input" name="inboxId" defaultValue={commsProduction?.inboxId || ""} />
                    </div>
                    <div className="field">
                      <label>Token API</label>
                      <input className="input" name="apiAccessToken" type="password" placeholder="••••••••" />
                      <div className="field-hint">Déjalo vacío para conservar el token actual.</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                    <div className="field">
                      <label>Plantilla WhatsApp (producto)</label>
                      <input
                        className="input"
                        name="productTemplateName"
                        placeholder="apiflujos_producto_link"
                        defaultValue={commsProduction?.productTemplateName || ""}
                      />
                      <div className="field-hint">Recomendado: plantilla con 4 variables en body (cliente, producto, precio, link).</div>
                    </div>
                    <div className="field">
                      <label>Idioma plantilla</label>
                      <input className="input" name="productTemplateLang" placeholder="es" defaultValue={commsProduction?.productTemplateLang || ""} />
                      <div className="field-hint">Ej: es, es_CO.</div>
                    </div>
                  </div>
                  <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {inlineMsg("central_delete", "Eliminado.", "Error eliminando", inlineState)}
                      <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" formAction={actions.deleteCentralConnection} aria-label="Eliminar conexión CentralCom" title="Eliminar conexión CentralCom" />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {inlineMsg("central_save", "Guardado.", "Error guardando", inlineState)}
                      {centralTestStatus === "ok" ? (
                        <div className="field-hint is-success" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>
                          Conexión exitosa
                        </div>
                      ) : centralTestStatus === "fail" ? (
                        <div className="field-hint" style={{ color: "var(--danger)" }}>Error conectando</div>
                      ) : null}
                      <DualActionButtons
                        primaryLabel="Guardar"
                        primaryPendingLabel="Guardando..."
                        primaryClassName="primary"
                        secondaryLabel="Probar conexión"
                        secondaryPendingLabel="Conectando..."
                        secondaryClassName="ghost"
                        secondaryFormAction={async (formData: FormData) => {
                          try {
                            await actions.testCentralConnection(formData);
                            setCentralTestStatus("ok");
                          } catch (err: any) {
                            setCentralTestStatus("fail");
                          }
                        }}
                      />
                    </div>
                  </div>
                </form>
              </div>

            </div>
          </div>
        </div>
      ) : null}

      {open === "shopify" ? (
        <div className="modal-backdrop">
          <div className="modal-panel modal-panel-fixed">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Shopify</h3>
              <button type="button" className="ghost modal-close" onClick={() => setOpen(null)} aria-label="Cerrar" data-modal-close="true" data-loader="off">X</button>
            </div>

            <div className="modal-body">
            <form ref={shopifyFormRef} action={actions.updateShopify} className="panel module" style={{ display: "grid", gap: 10 }}>
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
                  <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" formAction={actions.deleteShopifyConnection} aria-label="Eliminar conexión Shopify" title="Eliminar conexión Shopify" />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {inlineMsg("shopify_save", "Guardado.", "Error guardando", inlineState)}
                  {shopifyTestStatus === "ok" ? (
                    <div className="field-hint is-success">Forward OK.</div>
                  ) : shopifyTestStatus === "fail" ? (
                    <div className="field-hint" style={{ color: "var(--danger)" }}>
                      Error probando: {shopifyTestError || "unknown_error"}
                    </div>
                  ) : null}
                  <button className="ghost btn-compact" type="button" onClick={runShopifyTest} disabled={shopifyTestStatus === "pending"}>
                    {shopifyTestStatus === "pending" ? "Probando..." : "Probar forward"}
                  </button>
                  <PendingButton className="primary btn-compact" type="submit" pendingText="Guardando...">
                    Guardar
                  </PendingButton>
                </div>
              </div>
            </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
