import { updateChatwoot, updateShopify, updateWompi } from "./actions";

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
        <div style={{ color: "#666", marginBottom: 12 }}>
          Llave pública: {settings?.wompi?.publicKey || "—"} | Llave privada: {settings?.wompi?.privateKey || "—"} | Integridad:{" "}
          {settings?.wompi?.integritySecret || "—"} | Eventos: {settings?.wompi?.eventsSecret || "—"}
        </div>
        <form action={updateWompi} style={{ display: "grid", gap: 10 }}>
          <label>
            Llave pública
            <input name="publicKey" placeholder="pub_test_..." defaultValue={settings?.wompi?.publicKey || ""} style={{ width: "100%" }} />
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
            <input name="apiBaseUrl" placeholder="https://sandbox.wompi.co/v1" defaultValue={settings?.wompi?.apiBaseUrl || ""} style={{ width: "100%" }} />
          </label>
          <label>
            URL base de links de pago
            <input name="checkoutLinkBaseUrl" placeholder="https://checkout.wompi.co/l/" defaultValue={settings?.wompi?.checkoutLinkBaseUrl || ""} style={{ width: "100%" }} />
          </label>
          <label>
            URL de redirección (opcional)
            <input name="redirectUrl" defaultValue={settings?.wompi?.redirectUrl || ""} style={{ width: "100%" }} />
          </label>
          <button type="submit">Guardar Wompi</button>
        </form>
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
        <div style={{ color: "#666", marginBottom: 12 }}>
          Base: {settings?.chatwoot?.baseUrl || "—"} | cuenta: {settings?.chatwoot?.accountId || "—"} | bandeja: {settings?.chatwoot?.inboxId || "—"}
        </div>
        <form action={updateChatwoot} style={{ display: "grid", gap: 10 }}>
          <label>
            URL base
            <input name="baseUrl" placeholder="https://central.tu-dominio.com" defaultValue={settings?.chatwoot?.baseUrl || ""} style={{ width: "100%" }} />
          </label>
          <label>
            ID de cuenta
            <input name="accountId" defaultValue={settings?.chatwoot?.accountId || ""} style={{ width: "100%" }} />
          </label>
          <label>
            ID de inbox
            <input name="inboxId" defaultValue={settings?.chatwoot?.inboxId || ""} style={{ width: "100%" }} />
          </label>
          <label>
            Token de acceso API
            <input name="apiAccessToken" type="password" style={{ width: "100%" }} />
          </label>
          <button type="submit">Guardar central de comunicaciones</button>
        </form>
      </section>
    </main>
  );
}
