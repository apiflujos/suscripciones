import { setCentralActiveEnv, setWompiActiveEnv, updateChatwoot, updateShopify, updateWompi } from "./actions";

export const dynamic = "force-dynamic";

function getConfig() {
  const raw = String(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");
  const token = raw.replace(/^Bearer\\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
    token
  };
}

async function fetchSettings() {
  const { apiBase, token } = getConfig();
  if (!token) return { ok: false, status: 0 as number, json: null as any };
  const res = await fetch(`${apiBase}/admin/settings`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string } }) {
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

  return (
    <main style={{ display: "grid", gap: 16, maxWidth: 820 }}>
      <h1 style={{ marginTop: 0 }}>Credenciales</h1>
      {searchParams.saved ? <div style={{ padding: 12, background: "#eef", borderRadius: 8 }}>Guardado.</div> : null}

      {!settingsRes.ok ? (
        <div style={{ padding: 12, background: "#ffe", borderRadius: 8 }}>
          No se pudo consultar el API (<span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{settingsRes.status || "sin respuesta"}</span>
          ). Revisa `NEXT_PUBLIC_API_BASE_URL` y que el token del Admin coincida con `ADMIN_API_TOKEN` del API.
          <div style={{ marginTop: 8, color: "#666" }}>Token (Admin): {tokenInfo}.</div>
        </div>
      ) : null}

      {settingsRes.ok && !settings?.encryptionKeyConfigured ? (
        <div style={{ padding: 12, background: "#ffe", borderRadius: 8 }}>
          Falta `CREDENTIALS_ENCRYPTION_KEY_B64` en el API (Base64 de 32 bytes). Sin esto no se guardan secretos.
        </div>
      ) : null}

      {settingsRes.ok && settings?.encryptionKeyConfigured && settings?.encryptionKeyValid === false ? (
        <div style={{ padding: 12, background: "#ffe", borderRadius: 8 }}>
          `CREDENTIALS_ENCRYPTION_KEY_B64` está configurada pero es inválida. Debe ser Base64 de <strong>32 bytes</strong> (no 32 caracteres).
        </div>
      ) : null}

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Wompi</h2>
        <form action={setWompiActiveEnv} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#666" }}>Entorno activo</span>
            <select name="activeEnv" defaultValue={settings?.wompi?.activeEnv || "PRODUCTION"}>
              <option value="PRODUCTION">Producción</option>
              <option value="SANDBOX">Sandbox</option>
            </select>
          </label>
          <button type="submit">Guardar</button>
        </form>

        <div style={{ display: "grid", gap: 12 }}>
          {([
            ["PRODUCTION", "Producción"],
            ["SANDBOX", "Sandbox"]
          ] as const).map(([envKey, envLabel]) => {
            const cfg = settings?.wompi?.[envKey === "PRODUCTION" ? "production" : "sandbox"] || {};
            return (
              <div key={envKey} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "grid" }}>
                    <strong>{envLabel}</strong>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      Llave pública: {cfg.publicKey || "—"} | Llave privada: {cfg.privateKey || "—"} | Integridad: {cfg.integritySecret || "—"} | Eventos:{" "}
                      {cfg.eventsSecret || "—"} | API: {cfg.apiBaseUrl || "—"} | Links: {cfg.checkoutLinkBaseUrl || "—"}
                    </div>
                  </div>
                  <details>
                    <summary style={{ cursor: "pointer", listStyle: "none" }}>
                      <span style={{ display: "inline-block", padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd" }}>
                        Nueva conexión
                      </span>
                    </summary>
                    <div style={{ marginTop: 10 }}>
                      <form action={updateWompi} style={{ display: "grid", gap: 10 }}>
                        <input type="hidden" name="environment" value={envKey} />
                        <label>
                          Llave pública
                          <input name="publicKey" placeholder="pub_..." style={{ width: "100%" }} />
                        </label>
                        <label>
                          Llave privada
                          <input name="privateKey" type="password" style={{ width: "100%" }} />
                        </label>
                        <label>
                          Secreto de integridad
                          <input name="integritySecret" type="password" style={{ width: "100%" }} />
                        </label>
                        <label>
                          Secreto de eventos
                          <input name="eventsSecret" type="password" style={{ width: "100%" }} />
                        </label>
                        <label>
                          URL base del API
                          <input
                            name="apiBaseUrl"
                            placeholder={envKey === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1"}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label>
                          URL base de links de pago
                          <input name="checkoutLinkBaseUrl" placeholder="https://checkout.wompi.co/l/" style={{ width: "100%" }} />
                        </label>
                        <label>
                          URL de redirección (opcional)
                          <input name="redirectUrl" style={{ width: "100%" }} />
                        </label>
                        <button type="submit">Guardar</button>
                      </form>
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Conector de tienda (opcional)</h2>
        <div style={{ color: "#666", marginBottom: 12 }}>URL de reenvío: {settings?.shopify?.forwardUrl || "—"}</div>
        <form action={updateShopify} style={{ display: "grid", gap: 10 }}>
          <label>
            URL de reenvío
            <input name="forwardUrl" defaultValue={settings?.shopify?.forwardUrl || ""} style={{ width: "100%" }} />
          </label>
          <label>
            Secreto de reenvío (opcional)
            <input name="forwardSecret" type="password" style={{ width: "100%" }} />
          </label>
          <button type="submit">Guardar conector</button>
        </form>
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Central de comunicaciones</h2>
        <form action={setCentralActiveEnv} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#666" }}>Entorno activo</span>
            <select name="activeEnv" defaultValue={settings?.communications?.activeEnv || "PRODUCTION"}>
              <option value="PRODUCTION">Producción</option>
              <option value="SANDBOX">Sandbox</option>
            </select>
          </label>
          <button type="submit">Guardar</button>
        </form>

        <div style={{ display: "grid", gap: 12 }}>
          {([
            ["PRODUCTION", "Producción"],
            ["SANDBOX", "Sandbox"]
          ] as const).map(([envKey, envLabel]) => {
            const cfg = settings?.communications?.[envKey === "PRODUCTION" ? "production" : "sandbox"] || {};
            return (
              <div key={envKey} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "grid" }}>
                    <strong>{envLabel}</strong>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      Base: {cfg.baseUrl || "—"} | cuenta: {cfg.accountId || "—"} | bandeja: {cfg.inboxId || "—"}
                    </div>
                  </div>
                  <details>
                    <summary style={{ cursor: "pointer", listStyle: "none" }}>
                      <span style={{ display: "inline-block", padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd" }}>
                        Nueva conexión
                      </span>
                    </summary>
                    <div style={{ marginTop: 10 }}>
                      <form action={updateChatwoot} style={{ display: "grid", gap: 10 }}>
                        <input type="hidden" name="environment" value={envKey} />
                        <label>
                          URL base
                          <input name="baseUrl" placeholder="https://central.tu-dominio.com" style={{ width: "100%" }} />
                        </label>
                        <label>
                          ID de cuenta
                          <input name="accountId" style={{ width: "100%" }} />
                        </label>
                        <label>
                          ID de bandeja
                          <input name="inboxId" style={{ width: "100%" }} />
                        </label>
                        <label>
                          Token de acceso API
                          <input name="apiAccessToken" type="password" style={{ width: "100%" }} />
                        </label>
                        <button type="submit">Guardar</button>
                      </form>
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
