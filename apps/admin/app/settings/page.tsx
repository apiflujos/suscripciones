import { bootstrapCentralAttributes, setWompiActiveEnv, syncCentralAttributes, testCentralConnection, testShopifyForward, updateChatwoot, updateShopify, updateWompi } from "./actions";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { DualActionButtons } from "../ui/DualActionButtons";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchSettings() {
  return fetchAdminCached("/admin/settings", { ttlMs: 1500 });
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams: { a?: string; status?: string; error?: string };
}) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Credenciales</h1>
        <p>Configura `ADMIN_API_TOKEN` en el Admin para poder guardar credenciales.</p>
      </main>
    );
  }

  const settingsRes = await fetchSettings();
  const settings = settingsRes.ok ? settingsRes.json : null;
  const tokenInfo = (() => {
    const raw = String(process.env.ADMIN_API_TOKEN || "");
    const normalized = raw.replace(/^Bearer\\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
    const last4 = normalized ? normalized.slice(-4) : "";
    return normalized ? `longitud ${normalized.length} · termina en ${last4}` : "no detectado";
  })();

  const wompiActiveEnv = (settings?.wompi?.activeEnv || "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const wompiProduction = (settings?.wompi?.production || settings?.wompi || {}) as any;
  const wompiSandbox = (settings?.wompi?.sandbox || {}) as any;

  const comms = (settings?.communications || null) as any;
  const commsProduction = (comms?.production || settings?.chatwoot || {}) as any;

  const action = String(searchParams.a || "");
  const status = String(searchParams.status || "");
  const errorText = searchParams.error ? String(searchParams.error) : "";
  const isOk = status === "ok";
  const isFail = status === "fail";
  const inlineMsg = (key: string, okText: string, failPrefix: string) => {
    if (action !== key) return null;
    if (isOk) return <div className="field-hint">{okText}</div>;
    if (isFail) return <div className="field-hint" style={{ color: "var(--danger)" }}>{failPrefix}: {errorText || "unknown_error"}</div>;
    return null;
  };

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>Configuraciones</h1>

      {!settingsRes.ok ? (
        <div className="card cardPad">
          No se pudo consultar el API (<span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{settingsRes.status || "sin respuesta"}</span>
          ). Revisa `NEXT_PUBLIC_API_BASE_URL` y que el token del Admin coincida con `ADMIN_API_TOKEN` del API.
          <div style={{ marginTop: 8, color: "#666" }}>Token (Admin): {tokenInfo}.</div>
        </div>
      ) : null}

      {settingsRes.ok && !settings?.encryptionKeyConfigured ? (
        <div className="card cardPad">
          Falta `CREDENTIALS_ENCRYPTION_KEY_B64` en el API (Base64 de 32 bytes). Sin esto no se guardan secretos. Usa el mismo valor también en el servicio de jobs (`wompi-subs-jobs`).
        </div>
      ) : null}

      {settingsRes.ok && settings?.encryptionKeyConfigured && settings?.encryptionKeyValid === false ? (
        <div className="card cardPad">
          `CREDENTIALS_ENCRYPTION_KEY_B64` está configurada pero es inválida. Debe ser Base64 de <strong>32 bytes</strong> (no 32 caracteres).
        </div>
      ) : null}

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Wompi</h3>
              <HelpTip text="Configura credenciales para Producción y Sandbox." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <form action={setWompiActiveEnv} className="panel module" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" } as any}>
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
              {inlineMsg("wompi_env", "Guardado.", "Error guardando")}
              <PendingButton className="primary" type="submit" pendingText="Guardando...">
                Guardar
              </PendingButton>
            </div>
          </form>

          {([
            ["PRODUCTION", "Producción", wompiProduction],
            ["SANDBOX", "Sandbox", wompiSandbox]
          ] as const).map(([envKey, envLabel, cfg]) => (
            <div key={envKey} className="panel module">
              <div className="panelHeaderRow">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <strong>{envLabel}</strong>
                  {wompiActiveEnv === envKey ? <span className="pill">Activo</span> : <span className="pill" style={{ opacity: 0.65 }}>Inactivo</span>}
                </div>
                <details>
                  <summary className="ghost detailsSummary">Nueva conexión</summary>
                  <div className="detailsBody">
                    <form action={updateWompi} style={{ display: "grid", gap: 10 }}>
                      <input type="hidden" name="environment" value={envKey} />
                      <div className="field">
                        <label>
                          Llave pública
                          <HelpTip text="Clave pública de tu cuenta Wompi (empieza con pub_)." />
                        </label>
                        <input className="input" name="publicKey" placeholder="pub_..." />
                      </div>
                      <div className="field">
                        <label>
                          Llave privada
                          <HelpTip text="Clave privada de Wompi para autenticar llamadas." />
                        </label>
                        <input className="input" name="privateKey" type="password" />
                      </div>
                      <div className="field">
                        <label>
                          Secreto de integridad
                          <HelpTip text="Usado para firmar y validar la integridad de los eventos." />
                        </label>
                        <input className="input" name="integritySecret" type="password" />
                      </div>
                      <div className="field">
                        <label>
                          Secreto de eventos
                          <HelpTip text="Secreto para validar webhooks/eventos entrantes." />
                        </label>
                        <input className="input" name="eventsSecret" type="password" />
                      </div>
                      <div className="field">
                        <label>
                          URL base del API
                          <HelpTip text="Base del API de Wompi según entorno." />
                        </label>
                        <input
                          className="input"
                          name="apiBaseUrl"
                          placeholder={envKey === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1"}
                        />
                      </div>
                      <div className="field">
                        <label>
                          URL base de links de pago
                          <HelpTip text="Base para generar links de pago." />
                        </label>
                        <input className="input" name="checkoutLinkBaseUrl" placeholder="https://checkout.wompi.co/l/" />
                      </div>
                      <div className="field">
                        <label>
                          URL de redirección (opcional)
                          <HelpTip text="URL a la que Wompi redirige después del pago." />
                        </label>
                        <input className="input" name="redirectUrl" />
                      </div>
                      <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                        {inlineMsg("wompi_creds", "Guardado.", "Error guardando")}
                        <PendingButton className="primary" type="submit" pendingText="Guardando...">
                          Guardar
                        </PendingButton>
                      </div>
                    </form>
                  </div>
                </details>
              </div>
              <div className="panel module" style={{ marginTop: 10 }}>
                <div className="panelHeaderRow">
                  <strong>Conexión guardada</strong>
                </div>
                <div className="field-hint">
                  Llave pública: {cfg?.publicKey || "—"} · Llave privada: {cfg?.privateKey || "—"} · Integridad: {cfg?.integritySecret || "—"} · Eventos: {cfg?.eventsSecret || "—"}
                  {" · "}API: {cfg?.apiBaseUrl || "—"} · Links: {cfg?.checkoutLinkBaseUrl || "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Central de Comunicaciones Apiflujos</h3>
              <HelpTip text="Configura la conexión para enviar mensajes y campañas masivas." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <div className="panel module">
              <div className="panelHeaderRow">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <strong>Producción</strong>
                </div>
                <details>
                  <summary className="ghost detailsSummary">Nueva conexión</summary>
                  <div className="detailsBody">
                    <form action={updateChatwoot} style={{ display: "grid", gap: 10 }}>
                      <div className="field">
                        <label>
                          URL base
                          <HelpTip text="Ej: https://tu-central.com (sin / al final)" />
                        </label>
                        <input className="input" name="baseUrl" placeholder="https://central.tu-dominio.com" />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        <div className="field">
                          <label>
                            ID de cuenta
                            <HelpTip text="ID numérico de la cuenta en tu central." />
                          </label>
                          <input className="input" name="accountId" />
                        </div>
                        <div className="field">
                          <label>
                            ID de bandeja
                            <HelpTip text="ID numérico del inbox/bandeja." />
                          </label>
                          <input className="input" name="inboxId" />
                        </div>
                        <div className="field">
                          <label>
                            Token API
                            <HelpTip text="Token privado de la central para API." />
                          </label>
                          <input className="input" name="apiAccessToken" type="password" />
                        </div>
                      </div>
                      <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                        {inlineMsg("central_save", "Guardado.", "Error guardando")}
                        {inlineMsg("central_test", "Conexión exitosa.", "Error conectando")}
                        <DualActionButtons
                          primaryLabel="Guardar"
                          primaryPendingLabel="Guardando..."
                          primaryClassName="primary"
                          secondaryLabel="Probar conexión"
                          secondaryPendingLabel="Conectando..."
                          secondaryClassName="ghost"
                          secondaryFormAction={testCentralConnection}
                        />
                      </div>
                    </form>
                  </div>
                </details>
              </div>
              <div className="panel module" style={{ marginTop: 10 }}>
                <div className="panelHeaderRow">
                  <strong>Conexión guardada</strong>
                </div>
                <div className="field-hint">
                  Base: {commsProduction?.baseUrl || "—"} · cuenta: {commsProduction?.accountId || "—"} · bandeja: {commsProduction?.inboxId || "—"}
                </div>
              </div>
            </div>

          <div className="panel module" style={{ display: "grid", gap: 10 }}>
            <div className="panelHeaderRow">
              <strong>Acciones rápidas</strong>
            </div>
            <form action={bootstrapCentralAttributes}>
              {inlineMsg("central_bootstrap", "Atributos creados.", "Error creando")}
              <PendingButton className="ghost" type="submit" pendingText="Creando...">
                Crear atributos de contacto
              </PendingButton>
            </form>
            <form action={syncCentralAttributes} style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>
                  Límite a sincronizar
                  <HelpTip text="Cantidad máxima de contactos a sincronizar en esta ejecución." />
                </label>
                <input className="input" name="limit" placeholder="200" />
              </div>
              {inlineMsg("central_sync", "Sincronización iniciada.", "Error sincronizando")}
              <PendingButton className="ghost" type="submit" pendingText="Sincronizando...">
                Sincronizar contactos
              </PendingButton>
            </form>
            <div className="field-hint">Sincroniza atributos de pagos y suscripciones con la Central de Comunicaciones Apiflujos.</div>
          </div>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Conector de tienda (opcional)</h3>
              <HelpTip text="Reenvío de eventos/órdenes (si lo necesitas)." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <form action={updateShopify} className="panel module" style={{ display: "grid", gap: 10 }}>
            <div className="field">
              <label>
                URL de reenvío
                <HelpTip text="Endpoint del e-commerce para recibir eventos." />
              </label>
              <input className="input" name="forwardUrl" />
            </div>
            <div className="field">
              <label>
                Secreto de reenvío (opcional)
                <HelpTip text="Secreto compartido para validar los eventos reenviados." />
              </label>
              <input className="input" name="forwardSecret" type="password" />
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
              {inlineMsg("shopify_save", "Guardado.", "Error guardando")}
              {inlineMsg("shopify_test", "Forward OK.", "Error probando")}
              <DualActionButtons
                primaryLabel="Guardar"
                primaryPendingLabel="Guardando..."
                primaryClassName="primary"
                secondaryLabel="Probar forward"
                secondaryPendingLabel="Probando..."
                secondaryClassName="ghost"
                secondaryFormAction={testShopifyForward}
              />
            </div>
          </form>
          <div className="panel module" style={{ marginTop: 10 }}>
            <div className="panelHeaderRow">
              <strong>Conexión guardada</strong>
            </div>
            <div className="field-hint">URL: {settings?.shopify?.forwardUrl || "—"}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
