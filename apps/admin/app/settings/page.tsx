import {
  bootstrapCentralAttributes,
  deleteCentralConnection,
  setWompiActiveEnv,
  syncCentralAttributes,
  testCentralConnection,
  testShopifyForward,
  updateCheckoutConfig,
  updateChatwoot,
  updateShopify,
  updateWompi
} from "./actions";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { getCsrfToken } from "../lib/csrf";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { CheckoutTemplatesPanel } from "../checkout-templates/CheckoutTemplatesPanel";
import { createCheckoutTemplate, updateCheckoutTemplate, deleteCheckoutTemplate } from "../checkout-templates/actions";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchSettings() {
  return fetchAdminCached("/admin/settings", { ttlMs: 1500 });
}

async function fetchCheckoutTemplates() {
  return fetchAdminCached("/admin/checkout-templates", { ttlMs: 1500 });
}

async function fetchProducts() {
  return fetchAdminCached("/admin/products?take=200", { ttlMs: 1500 });
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ a?: string; status?: string; error?: string; tab?: string; new?: string; create?: string }>;
}) {
  const csrfToken = await getCsrfToken();
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
  const templatesRes = await fetchCheckoutTemplates();
  const productsRes = await fetchProducts();
  const settings = settingsRes.ok ? settingsRes.json : null;
  const templates = templatesRes.ok ? templatesRes.json?.items || [] : [];
  const products = productsRes.ok ? productsRes.json?.items || [] : [];
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const showTokenInfo = process.env.NODE_ENV !== "production" || session?.role === "SUPER_ADMIN";

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
  const commsSandbox = (comms?.sandbox || {}) as any;
  const sp = (await searchParams) ?? {};
  const action = String(sp.a || "");
  const status = String(sp.status || "");
  const errorText = sp.error ? String(sp.error) : "";
  const tab = String(sp.tab || "connections");
  const inlineState = { action, status, errorText };

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>Configuraciones</h1>
      <div className="settings-tabs">
        <a className={`settings-tab ${tab === "connections" ? "is-active" : ""}`} href="/settings?tab=connections">
          Conexiones
        </a>
        <a className={`settings-tab ${tab === "checkout-publico" ? "is-active" : ""}`} href="/settings?tab=checkout-publico">
          Checkout público
        </a>
      </div>

      {!settingsRes.ok ? (
        <div className="card cardPad">
          No se pudo consultar el API (<span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{settingsRes.status || "sin respuesta"}</span>
          ). Revisa `NEXT_PUBLIC_API_BASE_URL` y que el token del Admin coincida con `ADMIN_API_TOKEN` del API.
          {showTokenInfo ? <div style={{ marginTop: 8, color: "#666" }}>Token (Admin): {tokenInfo}.</div> : null}
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

      {tab === "connections" ? (
        <>
          <section className="settings-group">
            <div className="settings-group-header">
              <div className="panelHeaderRow">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h3>Conexiones</h3>
                  <HelpTip text="Abre cada conexión para configurar sus credenciales." />
                </div>
              </div>
            </div>
            <div className="settings-group-body">
              <ConnectionsPanel
                csrfToken={csrfToken}
                wompiActiveEnv={wompiActiveEnv}
                wompiProduction={wompiProduction}
                wompiSandbox={wompiSandbox}
                commsProduction={commsProduction}
                commsSandbox={commsSandbox}
                shopify={settings?.shopify || {}}
                actions={{
                  setWompiActiveEnv,
                  updateWompi,
                  updateChatwoot,
                  deleteCentralConnection,
                  testCentralConnection,
                  bootstrapCentralAttributes,
                  syncCentralAttributes,
                  updateShopify,
                  testShopifyForward
                }}
                inlineState={inlineState}
              />
            </div>
          </section>

          <section className="settings-group">
            <div className="settings-group-header">
              <div className="panelHeaderRow">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h3>Conexiones guardadas</h3>
                  <HelpTip text="Resumen de las conexiones actuales." />
                </div>
              </div>
            </div>
            <div className="settings-group-body">
              <div className="panel module">
                <div className="panelHeaderRow">
                  <strong>Wompi · Producción</strong>
                  {wompiActiveEnv === "PRODUCTION" ? (
                    <span className="pill" style={{ background: "#e7f8ee", color: "#0f6b3a", border: "1px solid #8dd9a9" }}>Activa</span>
                  ) : (
                    <span className="pill" style={{ opacity: 0.65 }}>Inactiva</span>
                  )}
                </div>
                <div className="field-hint">
                  Llave pública: {wompiProduction?.publicKey || "—"} · Llave privada: {wompiProduction?.privateKey || "—"} · Integridad: {wompiProduction?.integritySecret || "—"} · Eventos: {wompiProduction?.eventsSecret || "—"}
                  {" · "}API: {wompiProduction?.apiBaseUrl || "—"} · Links: {wompiProduction?.checkoutLinkBaseUrl || "—"} · Redirección: {wompiProduction?.redirectUrl || "—"}
                </div>
              </div>

              <div className="panel module">
                <div className="panelHeaderRow">
                  <strong>Wompi · Sandbox</strong>
                  {wompiActiveEnv === "SANDBOX" ? (
                    <span className="pill" style={{ background: "#e7f8ee", color: "#0f6b3a", border: "1px solid #8dd9a9" }}>Activa</span>
                  ) : (
                    <span className="pill" style={{ opacity: 0.65 }}>Inactiva</span>
                  )}
                </div>
                <div className="field-hint">
                  Llave pública: {wompiSandbox?.publicKey || "—"} · Llave privada: {wompiSandbox?.privateKey || "—"} · Integridad: {wompiSandbox?.integritySecret || "—"} · Eventos: {wompiSandbox?.eventsSecret || "—"}
                  {" · "}API: {wompiSandbox?.apiBaseUrl || "—"} · Links: {wompiSandbox?.checkoutLinkBaseUrl || "—"} · Redirección: {wompiSandbox?.redirectUrl || "—"}
                </div>
              </div>

              <div className="panel module">
                <div className="panelHeaderRow">
                  <strong>Central de Comunicaciones</strong>
                  <span className="pill" style={{ background: "#e7f8ee", color: "#0f6b3a", border: "1px solid #8dd9a9" }}>Activa</span>
                </div>
                <div className="field-hint">
                  Base: {commsProduction?.baseUrl || "—"} · cuenta: {commsProduction?.accountId || "—"} · bandeja: {commsProduction?.inboxId || "—"}
                </div>
              </div>

              <div className="panel module">
                <div className="panelHeaderRow">
                  <strong>Shopify</strong>
                  <span className="pill" style={{ background: "#e7f8ee", color: "#0f6b3a", border: "1px solid #8dd9a9" }}>Activa</span>
                </div>
                <div className="field-hint">URL: {settings?.shopify?.forwardUrl || "—"}</div>
              </div>
            </div>
          </section>

        </>
      ) : null}

      {tab === "checkout-publico" ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="panelHeaderRow">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3>Checkout público</h3>
                <HelpTip text="Crea plantillas de checkout para planes y suscripciones." />
              </div>
            </div>
          </div>
          <div className="settings-group-body">
            <form action={updateCheckoutConfig} className="panel module" style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <div className="panelHeaderRow">
                <strong>Dominio público</strong>
                <div className="field-hint">Se usa para construir la URL pública del checkout.</div>
              </div>
              <div className="field">
                <label>Base URL Plan</label>
                <input
                  className="input"
                  name="planBaseUrl"
                  defaultValue={settings?.checkoutConfig?.planBaseUrl || ""}
                  placeholder="https://pagos.tu-dominio.com"
                />
              </div>
              <div className="field">
                <label>Base URL Suscripción</label>
                <input
                  className="input"
                  name="subscriptionBaseUrl"
                  defaultValue={settings?.checkoutConfig?.subscriptionBaseUrl || ""}
                  placeholder="https://suscripciones.tu-dominio.com"
                />
              </div>
              <div className="module-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {inlineState.action === "checkout_config" && inlineState.status === "ok" ? <div className="field-hint">Configuración guardada.</div> : null}
                  {inlineState.action === "checkout_config" && inlineState.status === "fail" ? (
                    <div className="field-hint" style={{ color: "var(--danger)" }}>
                      Error: {inlineState.errorText || "unknown_error"}
                    </div>
                  ) : null}
                </div>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar dominio
                </PendingButton>
              </div>
            </form>
            <CheckoutTemplatesPanel
              templates={templates}
              products={products}
              csrfToken={csrfToken}
              inlineState={inlineState}
              baseUrls={{
                planBaseUrl: settings?.checkoutConfig?.planBaseUrl,
                subscriptionBaseUrl: settings?.checkoutConfig?.subscriptionBaseUrl
              }}
              actions={{
                create: createCheckoutTemplate,
                update: updateCheckoutTemplate,
                remove: deleteCheckoutTemplate
              }}
            />
          </div>
        </section>
      ) : null}

    </main>
  );
}
