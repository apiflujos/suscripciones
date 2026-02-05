import { setCentralActiveEnv, setWompiActiveEnv, updateChatwoot, updateShopify, updateWompi } from "./actions";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { HelpTip } from "../ui/HelpTip";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchSettings() {
  return fetchAdminCached("/admin/settings", { ttlMs: 1500 });
}

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  const { token } = getConfig();
  if (!token) {
    return (
      <main>
        <h1 style={{ marginTop: 0 }}>Credenciales</h1>
        <p>Configura `API_ADMIN_TOKEN` (o `ADMIN_API_TOKEN`) en el Admin para poder guardar credenciales.</p>
      </main>
    );
  }

  const settingsRes = await fetchSettings();
  const settings = settingsRes.ok ? settingsRes.json : null;
  const tokenInfo = (() => {
    const raw = String(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");
    const normalized = raw.replace(/^Bearer\\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
    const last4 = normalized ? normalized.slice(-4) : "";
    return normalized ? `longitud ${normalized.length} · termina en ${last4}` : "no detectado";
  })();

  const wompiActiveEnv = (settings?.wompi?.activeEnv || "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const wompiProduction = (settings?.wompi?.production || settings?.wompi || {}) as any;
  const wompiSandbox = (settings?.wompi?.sandbox || {}) as any;

  const comms = (settings?.communications || null) as any;
  const commsActiveEnv = (comms?.activeEnv || "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const commsProduction = (comms?.production || settings?.chatwoot || {}) as any;
  const commsSandbox = (comms?.sandbox || {}) as any;

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>Configuraciones</h1>
      {searchParams.saved ? <div className="card cardPad">Guardado.</div> : null}
      {searchParams.error ? (
        <div className="card cardPad" style={{ borderColor: "var(--danger)" }}>
          No se pudo guardar: {String(searchParams.error)}
        </div>
      ) : null}

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
              <label>Entorno activo</label>
              <select className="select" name="activeEnv" defaultValue={wompiActiveEnv}>
                <option value="PRODUCTION">Producción</option>
                <option value="SANDBOX">Sandbox</option>
              </select>
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="primary" type="submit">
                Guardar
              </button>
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
                        <label>Llave pública</label>
                        <input className="input" name="publicKey" placeholder="pub_..." defaultValue={cfg?.publicKey || ""} />
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
                          defaultValue={cfg?.apiBaseUrl || ""}
                        />
                      </div>
                      <div className="field">
                        <label>URL base de links de pago</label>
                        <input className="input" name="checkoutLinkBaseUrl" placeholder="https://checkout.wompi.co/l/" defaultValue={cfg?.checkoutLinkBaseUrl || ""} />
                      </div>
                      <div className="field">
                        <label>URL de redirección (opcional)</label>
                        <input className="input" name="redirectUrl" defaultValue={cfg?.redirectUrl || ""} />
                      </div>
                      <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="primary" type="submit">
                          Guardar
                        </button>
                      </div>
                    </form>
                  </div>
                </details>
              </div>
              <div className="field-hint">
                Llave pública: {cfg?.publicKey || "—"} · Llave privada: {cfg?.privateKey || "—"} · Integridad: {cfg?.integritySecret || "—"} · Eventos: {cfg?.eventsSecret || "—"}
                {" · "}API: {cfg?.apiBaseUrl || "—"} · Links: {cfg?.checkoutLinkBaseUrl || "—"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header">
          <div className="panelHeaderRow">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3>Central de comunicaciones</h3>
              <HelpTip text="Configura la conexión para enviar mensajes y links de cobro." />
            </div>
          </div>
        </div>
        <div className="settings-group-body">
          <form action={setCentralActiveEnv} className="panel module" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" } as any}>
            <div className="field">
              <label>Entorno activo</label>
              <select className="select" name="activeEnv" defaultValue={commsActiveEnv}>
                <option value="PRODUCTION">Producción</option>
                <option value="SANDBOX">Sandbox</option>
              </select>
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="primary" type="submit">
                Guardar
              </button>
            </div>
          </form>

          {([
            ["PRODUCTION", "Producción", commsProduction],
            ["SANDBOX", "Sandbox", commsSandbox]
          ] as const).map(([envKey, envLabel, cfg]) => (
            <div key={envKey} className="panel module">
              <div className="panelHeaderRow">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <strong>{envLabel}</strong>
                  {commsActiveEnv === envKey ? <span className="pill">Activo</span> : <span className="pill" style={{ opacity: 0.65 }}>Inactivo</span>}
                </div>
                <details>
                  <summary className="ghost detailsSummary">Nueva conexión</summary>
                  <div className="detailsBody">
                    <form action={updateChatwoot} style={{ display: "grid", gap: 10 }}>
                      <input type="hidden" name="environment" value={envKey} />
                      <div className="field">
                        <label>URL base</label>
                        <input className="input" name="baseUrl" placeholder="https://central.tu-dominio.com" defaultValue={cfg?.baseUrl || ""} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        <div className="field">
                          <label>ID de cuenta</label>
                          <input className="input" name="accountId" defaultValue={cfg?.accountId || ""} />
                        </div>
                        <div className="field">
                          <label>ID de bandeja</label>
                          <input className="input" name="inboxId" defaultValue={cfg?.inboxId || ""} />
                        </div>
                        <div className="field">
                          <label>Token API</label>
                          <input className="input" name="apiAccessToken" type="password" />
                        </div>
                      </div>
                      <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="primary" type="submit">
                          Guardar
                        </button>
                      </div>
                    </form>
                  </div>
                </details>
              </div>
              <div className="field-hint">
                Base: {cfg?.baseUrl || "—"} · cuenta: {cfg?.accountId || "—"} · bandeja: {cfg?.inboxId || "—"}
              </div>
            </div>
          ))}
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
              <label>URL de reenvío</label>
              <input className="input" name="forwardUrl" defaultValue={settings?.shopify?.forwardUrl || ""} />
            </div>
            <div className="field">
              <label>Secreto de reenvío (opcional)</label>
              <input className="input" name="forwardSecret" type="password" />
            </div>
            <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="primary" type="submit">
                Guardar
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
