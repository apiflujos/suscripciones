import {
  bootstrapCentralAttributes,
  deleteShopifyConnection,
  deleteCentralConnection,
  setWompiActiveEnv,
  syncCentralAttributes,
  testCentralConnection,
  testWompiConnection,
  testShopifyForward,
  updateCheckoutConfig,
  updateChatwoot,
  updateShopify,
  updateWompi,
  deleteWompiConnection,
  setCentralActiveEnv
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
import { RedirectConfigPanel } from "./RedirectConfigPanel";

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

async function fetchTenants() {
  return fetchAdminCached("/admin/tenants", { ttlMs: 1500 });
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
  const tenantsRes = await fetchTenants();
  const settings = settingsRes.ok ? settingsRes.json : null;
  const templates = templatesRes.ok ? templatesRes.json?.items || [] : [];
  const products = productsRes.ok ? productsRes.json?.items || [] : [];
  const tenants = tenantsRes.ok ? tenantsRes.json?.items || [] : [];
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
  const commsActiveEnv = (comms?.activeEnv || "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const sp = (await searchParams) ?? {};
  const action = String(sp.a || "");
  const status = String(sp.status || "");
  const errorText = sp.error ? String(sp.error) : "";
  const tab = String(sp.tab || "connections");
  const open = String(sp.open || "");
  const templateKind = String(sp.kind || "").toUpperCase();
  const templateStep = String(sp.step || "choose");
  const inlineState = { action, status, errorText };
  const returnTo = `/settings?${new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        tab,
        ...(open ? { open } : {}),
        ...(templateKind ? { kind: templateKind } : {}),
        ...(templateStep ? { step: templateStep } : {})
      }).filter(([, v]) => String(v || "").length > 0)
    )
  ).toString()}`;

  const maskSecret = (value: any) => {
    const raw = String(value || "").trim();
    if (!raw) return "—";
    const last4 = raw.slice(-4);
    return `••••••••${last4}`;
  };

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
                commsActiveEnv={commsActiveEnv}
                shopify={settings?.shopify || {}}
                actions={{
                  setWompiActiveEnv,
                  updateWompi,
                  testWompiConnection,
                  deleteWompiConnection,
                  updateChatwoot,
                  setCentralActiveEnv,
                  deleteCentralConnection,
                  testCentralConnection,
                  bootstrapCentralAttributes,
                  syncCentralAttributes,
                  updateShopify,
                  deleteShopifyConnection,
                  testShopifyForward
                }}
                inlineState={inlineState}
                initialOpen={open}
                returnTo={returnTo}
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
              <div className="saved-connections-grid">
                {([
                  ["PRODUCTION", "Producción", wompiProduction],
                  ["SANDBOX", "Sandbox", wompiSandbox]
                ] as const).map(([envKey, envLabel, wompi]) => (
                  <div className="saved-conn-card" key={`wompi-${envKey}`}>
                    <div className="saved-conn-header">
                      <div>
                        <strong>Wompi · {envLabel}</strong>
                        <div className="saved-conn-sub">{envKey === wompiActiveEnv ? "Activa" : "Inactiva"}</div>
                      </div>
                      <span className={`pill ${envKey === wompiActiveEnv ? "pill-green" : "pill-muted"}`}>
                        {envKey === wompiActiveEnv ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <div className="saved-conn-actions">
                      <a className="ghost" href="/settings?tab=connections&open=wompi">Editar</a>
                      <form action={testWompiConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={envKey} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost" type="submit">Probar</button>
                      </form>
                      <form action={deleteWompiConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={envKey} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost" type="submit">Eliminar</button>
                      </form>
                    </div>
                    <div className="saved-conn-meta">
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Llave pública</span>
                        <span className="saved-conn-meta-value">{wompi?.publicKey || "—"}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Llave privada</span>
                        <span className="saved-conn-meta-value">{maskSecret(wompi?.privateKey)}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Integridad</span>
                        <span className="saved-conn-meta-value">{maskSecret(wompi?.integritySecret)}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Eventos</span>
                        <span className="saved-conn-meta-value">{maskSecret(wompi?.eventsSecret)}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">API</span>
                        <span className="saved-conn-meta-value">{wompi?.apiBaseUrl || "—"}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Links</span>
                        <span className="saved-conn-meta-value">{wompi?.checkoutLinkBaseUrl || "—"}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Redirección</span>
                        <span className="saved-conn-meta-value">{wompi?.redirectUrl || "—"}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {([
                  ["PRODUCTION", "Producción", commsProduction],
                  ["SANDBOX", "Sandbox", commsSandbox]
                ] as const).map(([envKey, envLabel, comms]) => (
                  <div className="saved-conn-card" key={`central-${envKey}`}>
                    <div className="saved-conn-header">
                      <div>
                        <strong>Central · {envLabel}</strong>
                        <div className="saved-conn-sub">{comms?.baseUrl ? "Configurada" : "Sin configurar"}</div>
                      </div>
                      <span className={`pill ${envKey === commsActiveEnv ? "pill-green" : "pill-muted"}`}>
                        {envKey === commsActiveEnv ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <div className="saved-conn-actions">
                      <a className="ghost" href="/settings?tab=connections&open=central">Editar</a>
                      <form action={testCentralConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="baseUrl" value={comms?.baseUrl || ""} />
                        <input type="hidden" name="accountId" value={comms?.accountId || ""} />
                        <input type="hidden" name="inboxId" value={comms?.inboxId || ""} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost" type="submit" disabled={!comms?.baseUrl || !comms?.accountId || !comms?.inboxId}>
                          Probar
                        </button>
                      </form>
                      <form action={deleteCentralConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={envKey} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost" type="submit">Eliminar</button>
                      </form>
                    </div>
                    <div className="saved-conn-meta">
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Base URL</span>
                        <span className="saved-conn-meta-value">{comms?.baseUrl || "—"}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Cuenta</span>
                        <span className="saved-conn-meta-value">{comms?.accountId || "—"}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Bandeja</span>
                        <span className="saved-conn-meta-value">{comms?.inboxId || "—"}</span>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="saved-conn-card">
                  <div className="saved-conn-header">
                    <div>
                      <strong>Shopify</strong>
                      <div className="saved-conn-sub">{settings?.shopify?.forwardUrl ? "Configurada" : "Sin configurar"}</div>
                    </div>
                    <span className={`pill ${settings?.shopify?.forwardUrl ? "pill-green" : "pill-muted"}`}>
                      {settings?.shopify?.forwardUrl ? "Activa" : "Inactiva"}
                    </span>
                  </div>
                  <div className="saved-conn-actions">
                    <a className="ghost" href="/settings?tab=connections&open=shopify">Editar</a>
                    <form action={testShopifyForward}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="forwardUrl" value={settings?.shopify?.forwardUrl || ""} />
                      <input type="hidden" name="forwardOrigin" value={settings?.shopify?.forwardOrigin || "shopify"} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost" type="submit" disabled={!settings?.shopify?.forwardUrl}>Probar</button>
                    </form>
                    <form action={deleteShopifyConnection}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost" type="submit">Eliminar</button>
                    </form>
                  </div>
                  <div className="saved-conn-meta">
                    <div className="saved-conn-meta-item">
                      <span className="saved-conn-meta-label">URL</span>
                      <span className="saved-conn-meta-value">{settings?.shopify?.forwardUrl || "—"}</span>
                    </div>
                    <div className="saved-conn-meta-item">
                      <span className="saved-conn-meta-label">Origen</span>
                      <span className="saved-conn-meta-value">{settings?.shopify?.forwardOrigin || "—"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <form action={updateCheckoutConfig} className="panel module" style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <div className="panelHeaderRow">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>Dominio personalizado del checkout</strong>
                    <HelpTip text="Sirve para reemplazar el dominio genérico de Apiflujos por uno propio. Ej: pagos.tudominio.com en lugar de mdv.sus.apiflujos.com." />
                  </div>
                  <div className="field-hint">Si lo dejas vacío, usamos el dominio público por defecto.</div>
                </div>
                <div className="field-hint">
                  Instrucciones DNS para dominio propio:
                  <div className="field-hint">1. Crea un registro CNAME apuntando tu dominio al dominio público de Apiflujos.</div>
                  <div className="field-hint">2. Espera propagación y luego guarda aquí la Base URL.</div>
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
                    Guardar dominio personalizado
                  </PendingButton>
                </div>
              </form>
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
            <RedirectConfigPanel
              defaults={settings?.checkoutConfig || {}}
              csrfToken={csrfToken}
              onSave={updateCheckoutConfig}
              inlineState={inlineState}
              returnTo={returnTo}
            />
            <CheckoutTemplatesPanel
              templates={templates}
              products={products}
              tenants={tenants}
              csrfToken={csrfToken}
              inlineState={inlineState}
              initialKind={templateKind === "PLAN" || templateKind === "SUBSCRIPTION" ? (templateKind as any) : ""}
              initialStep={templateStep === "form" ? "form" : "choose"}
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
