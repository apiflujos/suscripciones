import {
  bootstrapCentralAttributes,
  deleteShopifyConnection,
  deleteCentralConnection,
  setWompiActiveEnv,
  syncCentralAttributes,
  testCentralConnection,
  testWompiConnection,
  testShopifyForward,
  updateChatwoot,
  updateShopify,
  updateWompi,
  deleteWompiConnection,
  setCentralActiveEnv,
  updateAiProvider,
  deleteAiProvider,
  updateGamificationConfig
} from "./actions";
import { fetchAdminCached, getAdminApiConfig } from "../lib/adminApi";
import { normalizeErrorParam } from "../lib/errorParam";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { getCsrfToken } from "../lib/csrf";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { LogoUploadField } from "./LogoUploadField";
import { CheckoutTemplatesPanel } from "../checkout-templates/CheckoutTemplatesPanel";
import { createCheckoutTemplate, updateCheckoutTemplate, deleteCheckoutTemplate, duplicateCheckoutTemplate, createCheckoutTemplateDefaults } from "../checkout-templates/actions";
import { RedirectConfigPanel } from "./RedirectConfigPanel";
import { createTenant, deleteTenant, updateTenant } from "../tenants/actions";
import { updateCheckoutConfig } from "./actions";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { GamificationPanel } from "./GamificationPanel";

export const dynamic = "force-dynamic";

function getConfig() {
  return getAdminApiConfig();
}

async function fetchSettings() {
  return fetchAdminCached("/admin/settings", { ttlMs: 0 });
}

async function fetchCheckoutTemplates() {
  return fetchAdminCached("/admin/checkout-templates", { ttlMs: 0 });
}

async function fetchProducts() {
  return fetchAdminCached("/admin/products?take=200", { ttlMs: 1500 });
}

async function fetchTenants() {
  return fetchAdminCached("/admin/tenants", { ttlMs: 0 });
}

async function fetchGamificationConfig() {
  return fetchAdminCached("/admin/gamification/config", { ttlMs: 1500 });
}

async function fetchTrending(scope: string, hours: number) {
  const sp = new URLSearchParams({ scope, windowHours: String(hours) });
  return fetchAdminCached(`/admin/gamification/trending?${sp.toString()}`, { ttlMs: 1500 });
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
      <main className="page pageWide">
        <p>Configura `ADMIN_API_TOKEN` en el Admin para poder guardar credenciales.</p>
      </main>
    );
  }

  const settingsRes = await fetchSettings();
  const templatesRes = await fetchCheckoutTemplates();
  const productsRes = await fetchProducts();
  const tenantsRes = await fetchTenants();
  const gamificationRes = await fetchGamificationConfig();
  const [trendCustomers24h, trendCustomers7d, trendCustomers30d, trendProducts24h, trendProducts7d, trendProducts30d] =
    await Promise.all([
      fetchTrending("customers", 24),
      fetchTrending("customers", 168),
      fetchTrending("customers", 720),
      fetchTrending("products", 24),
      fetchTrending("products", 168),
      fetchTrending("products", 720)
    ]);
  const settings = settingsRes.ok ? settingsRes.json : null;
  const gamificationConfig = gamificationRes.ok ? gamificationRes.json?.config : null;
  const templates = templatesRes.ok ? templatesRes.json?.items || [] : [];
  const products = productsRes.ok ? productsRes.json?.items || [] : [];
  const tenants = (tenantsRes.ok ? tenantsRes.json?.items || [] : []).filter((t: any) => t?.active !== false);
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
  const appPublicBaseUrl = String(process.env.APP_PUBLIC_BASE_URL || "").trim();
  const commsSandbox = (comms?.sandbox || {}) as any;
  const commsActiveEnv = (comms?.activeEnv || "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const ai = (settings?.ai || {}) as any;
  const aiProviders = (ai?.providers || {}) as any;
  const aiOpenai = (aiProviders?.openai || {}) as any;
  const aiDeepseek = (aiProviders?.deepseek || {}) as any;
  const aiEnabled = Boolean(ai?.enabled);
  const aiDisableReason = String(ai?.reason || "");
  const aiDisableLabel =
    aiDisableReason === "module_inactive"
      ? "Módulo IA inactivo globalmente"
      : aiDisableReason === "module_missing"
        ? "Módulo IA no existe"
        : aiDisableReason
          ? `IA bloqueada (${aiDisableReason})`
          : "";
  const openaiStatus = aiOpenai?.configured ? "Activa" : "Inactiva";
  const openaiPill = aiOpenai?.configured ? "pill-green" : "pill-muted";
  const deepseekStatus = aiDeepseek?.configured ? "Activa" : "Inactiva";
  const deepseekPill = aiDeepseek?.configured ? "pill-green" : "pill-muted";
  const sp = (await searchParams) ?? {};
  const action = String(sp.a || "");
  const status = String(sp.status || "");
  const errorText = normalizeErrorParam(typeof sp.error === "string" ? sp.error : undefined);
  const tab = String(sp.tab || "connections");
  const gviewRaw = String(sp.gview || "compact");
  const gamificationView = gviewRaw === "full" ? "full" : "compact";
  const open = String(sp.open || "");
  const openTenant = String(sp.openTenant || "").trim();
  const templateKind = String(sp.kind || "").toUpperCase();
  const templateStep = String(sp.step || "choose");
  const tenantDeleteBlocked = String(sp.tenantDeleteBlocked || "") === "1";
  const tenantArchived = String(sp.tenantArchived || "") === "1";
  const tenantDeleteStats = {
    customers: Number(sp.tenantCustomers || 0),
    plans: Number(sp.tenantPlans || 0),
    subscriptions: Number(sp.tenantSubscriptions || 0),
    payments: Number(sp.tenantPayments || 0),
    paymentLinks: Number(sp.tenantPaymentLinks || 0),
    checkoutTemplates: Number(sp.tenantCheckoutTemplates || 0)
  };
  const inlineState = { action, status, errorText };
  const returnTo = `/settings?${new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        tab,
        ...(tab === "gamificacion" ? { gview: gamificationView } : {}),
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
    <main className="page pageWide settingsPage">
      <div className="settings-tabs">
        <a className={`settings-tab ${tab === "connections" ? "is-active" : ""}`} href="/settings?tab=connections">
          Conexiones
        </a>
        <a className={`settings-tab ${tab === "checkout-publico" ? "is-active" : ""}`} href="/settings?tab=checkout-publico">
          Checkout público
        </a>
        <a className={`settings-tab ${tab === "canales" ? "is-active" : ""}`} href="/settings?tab=canales">
          Canales de venta
        </a>
        <a className={`settings-tab ${tab === "gamificacion" ? "is-active" : ""}`} href="/settings?tab=gamificacion">
          Gamificación
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

      {tab === "gamificacion" ? (
        <GamificationPanel
          csrfToken={csrfToken}
          config={gamificationConfig}
          view={gamificationView}
          trending={{
            customers24h: trendCustomers24h.ok ? trendCustomers24h.json?.items || [] : [],
            customers7d: trendCustomers7d.ok ? trendCustomers7d.json?.items || [] : [],
            customers30d: trendCustomers30d.ok ? trendCustomers30d.json?.items || [] : [],
            products24h: trendProducts24h.ok ? trendProducts24h.json?.items || [] : [],
            products7d: trendProducts7d.ok ? trendProducts7d.json?.items || [] : [],
            products30d: trendProducts30d.ok ? trendProducts30d.json?.items || [] : []
          }}
          actions={{ updateGamificationConfig }}
        />
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
              <div className="saved-connections-grid settings-saved-grid">
                {([
                  ["PRODUCTION", "Producción", wompiProduction],
                  ["SANDBOX", "Sandbox", wompiSandbox]
                ] as const)
                  .filter(([envKey]) => envKey === wompiActiveEnv)
                  .map(([envKey, envLabel, wompi]) => (
                  <div className="saved-conn-card" key={`wompi-${envKey}`}>
                    <div className="saved-conn-header">
                      <div className="saved-conn-title-row">
                        <img className="saved-conn-icon" src="/brand/conn-wompi.png" alt="" />
                        <div>
                          <strong>Wompi · {envLabel}</strong>
                          <div className="saved-conn-sub">
                            {wompi?.publicKey && wompi?.privateKey && wompi?.integritySecret && wompi?.eventsSecret ? "Configurada" : "Sin configurar"}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`pill ${
                          envKey === wompiActiveEnv && wompi?.publicKey && wompi?.privateKey && wompi?.integritySecret && wompi?.eventsSecret
                            ? "pill-green"
                            : "pill-muted"
                        }`}
                      >
                        {envKey === wompiActiveEnv && wompi?.publicKey && wompi?.privateKey && wompi?.integritySecret && wompi?.eventsSecret ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <div className="saved-conn-actions">
                      <a className="ghost btn-compact btn-blue" href="/settings?tab=connections&open=wompi">Editar</a>
                      <form action={testWompiConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={envKey} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost btn-compact btn-amber" type="submit">Probar</button>
                      </form>
                      <form action={deleteWompiConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={envKey} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost btn-compact btn-red" type="submit">Eliminar</button>
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
                        <span className="saved-conn-meta-label">Eventos</span>
                        <span className="saved-conn-meta-value">{maskSecret(wompi?.eventsSecret)}</span>
                      </div>
                      <div className="saved-conn-meta-item">
                        <span className="saved-conn-meta-label">Integridad</span>
                        <span className="saved-conn-meta-value">{maskSecret(wompi?.integritySecret)}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {([
                  ["PRODUCTION", "Producción", commsProduction],
                  ["SANDBOX", "Sandbox", commsSandbox]
                ] as const)
                  .filter(([envKey]) => envKey === commsActiveEnv)
                  .map(([envKey, envLabel, comms]) => (
                  <div className="saved-conn-card" key={`central-${envKey}`}>
                    <div className="saved-conn-header">
                      <div>
                        <strong>Central · {envLabel}</strong>
                        <div className="saved-conn-sub">{comms?.baseUrl && comms?.accountId && comms?.inboxId ? "Configurada" : "Sin configurar"}</div>
                      </div>
                      <span
                        className={`pill ${
                          envKey === commsActiveEnv && comms?.baseUrl && comms?.accountId && comms?.inboxId ? "pill-green" : "pill-muted"
                        }`}
                      >
                        {envKey === commsActiveEnv && comms?.baseUrl && comms?.accountId && comms?.inboxId ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <div className="saved-conn-actions">
                      <a className="ghost btn-compact btn-blue" href="/settings?tab=connections&open=central">Editar</a>
                      <form action={testCentralConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="baseUrl" value={comms?.baseUrl || ""} />
                        <input type="hidden" name="accountId" value={comms?.accountId || ""} />
                        <input type="hidden" name="inboxId" value={comms?.inboxId || ""} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost btn-compact btn-amber" type="submit" disabled={!comms?.baseUrl || !comms?.accountId || !comms?.inboxId}>
                          Probar
                        </button>
                      </form>
                      <form action={deleteCentralConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={envKey} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost btn-compact btn-red" type="submit">Eliminar</button>
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

                {settings?.shopify?.forwardUrl ? (
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
                    <a className="ghost btn-compact btn-blue" href="/settings?tab=connections&open=shopify">Editar</a>
                    <form action={testShopifyForward}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="forwardUrl" value={settings?.shopify?.forwardUrl || ""} />
                      <input type="hidden" name="forwardOrigin" value={settings?.shopify?.forwardOrigin || "shopify"} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost btn-compact btn-amber" type="submit" disabled={!settings?.shopify?.forwardUrl}>Probar</button>
                    </form>
                    <form action={deleteShopifyConnection}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost btn-compact btn-red" type="submit">Eliminar</button>
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
                ) : null}
              </div>

            </div>
          </section>

          {aiEnabled ? (
            <section className="settings-group">
              <div className="settings-group-header">
                <div className="panelHeaderRow">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <h3>Inteligencia artificial</h3>
                    <HelpTip text="Configura una o ambas llaves. Si una falla, usamos la otra automáticamente." />
                  </div>
                </div>
              </div>
              <div className="settings-group-body">
                <div className="saved-connections-grid settings-saved-grid">
                  <div className="saved-conn-card">
                    <div className="saved-conn-header">
                      <div>
                        <strong>OpenAI</strong>
                        <div className="saved-conn-sub">
                          {aiOpenai?.configured ? "Configurada · Modelo fijo gpt-4o-mini" : "Sin configurar"}
                        </div>
                      </div>
                      <span className={`pill ${openaiPill}`}>
                        {openaiStatus}
                      </span>
                    </div>
                    <form action={updateAiProvider} className="stack">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="provider" value="OPENAI" />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <div className="field">
                        <label>API Key</label>
                        <input
                          className="input"
                          type="password"
                          name="apiKey"
                          placeholder={aiOpenai?.apiKeyMasked ? `Configurada (${aiOpenai.apiKeyMasked})` : "Sin configurar"}
                        />
                      </div>
                      <PendingButton className="ghost btn-save" type="submit" pendingText="Guardando...">
                        Guardar
                      </PendingButton>
                    </form>
                    <form action={deleteAiProvider} className="saved-conn-actions">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="provider" value="OPENAI" />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost btn-compact btn-red" type="submit">Eliminar</button>
                    </form>
                  </div>

                  <div className="saved-conn-card">
                    <div className="saved-conn-header">
                      <div>
                        <strong>DeepSeek</strong>
                        <div className="saved-conn-sub">{aiDeepseek?.configured ? "Configurada" : "Sin configurar"}</div>
                      </div>
                      <span className={`pill ${deepseekPill}`}>
                        {deepseekStatus}
                      </span>
                    </div>
                    <form action={updateAiProvider} className="stack">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="provider" value="DEEPSEEK" />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <div className="field">
                        <label>API Key</label>
                        <input
                          className="input"
                          type="password"
                          name="apiKey"
                          placeholder={aiDeepseek?.apiKeyMasked ? `Configurada (${aiDeepseek.apiKeyMasked})` : "Sin configurar"}
                        />
                      </div>
                      <PendingButton className="ghost btn-save" type="submit" pendingText="Guardando...">
                        Guardar
                      </PendingButton>
                    </form>
                    <form action={deleteAiProvider} className="saved-conn-actions">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="provider" value="DEEPSEEK" />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost btn-compact btn-red" type="submit">Eliminar</button>
                    </form>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="settings-group">
              <div className="settings-group-header">
                <div className="panelHeaderRow">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <h3>Inteligencia artificial</h3>
                    <HelpTip text="Esta sección requiere habilitación del super admin." />
                  </div>
                </div>
              </div>
              <div className="settings-group-body">
                <div className="card cardPad">
                  La IA está deshabilitada globalmente. Solicita al super admin habilitar el módulo.
                  {aiDisableLabel ? <div className="field-hint">Motivo: {aiDisableLabel}.</div> : null}
                </div>
              </div>
            </section>
          )}

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
              appPublicBaseUrl={appPublicBaseUrl}
              csrfToken={csrfToken}
              returnTo={`/settings?${new URLSearchParams({ tab: "checkout-publico" }).toString()}`}
              onSave={updateCheckoutConfig}
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
                remove: deleteCheckoutTemplate,
                duplicate: duplicateCheckoutTemplate,
                defaults: createCheckoutTemplateDefaults
              }}
            />
          </div>
        </section>
      ) : null}

      {tab === "canales" ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="panelHeaderRow">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3>Canales de venta</h3>
                <HelpTip text="Gestiona los canales (tenants) disponibles en la app." />
              </div>
            </div>
          </div>
          <div className="settings-group-body">
            {tenantDeleteBlocked ? (
              <div className="card cardPad" style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}>
                No se puede eliminar el canal porque tiene datos asociados.
                <div style={{ marginTop: 6, color: "#666" }}>
                  {[
                    tenantDeleteStats.customers ? `Clientes: ${tenantDeleteStats.customers}` : null,
                    tenantDeleteStats.plans ? `Planes: ${tenantDeleteStats.plans}` : null,
                    tenantDeleteStats.subscriptions ? `Suscripciones: ${tenantDeleteStats.subscriptions}` : null,
                    tenantDeleteStats.payments ? `Pagos: ${tenantDeleteStats.payments}` : null,
                    tenantDeleteStats.paymentLinks ? `Links de pago: ${tenantDeleteStats.paymentLinks}` : null,
                    tenantDeleteStats.checkoutTemplates ? `Plantillas checkout: ${tenantDeleteStats.checkoutTemplates}` : null
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            ) : null}
            {tenantArchived ? (
              <div className="card cardPad" style={{ borderColor: "rgba(16, 185, 129, 0.22)", background: "rgba(16, 185, 129, 0.08)" }}>
                Canal archivado. Ya no aparece en la lista.
              </div>
            ) : null}
            <div className="card cardPad" style={{ marginBottom: 16 }}>
              <form action={createTenant} className="row" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <div className="field" style={{ minWidth: 240, flex: 1 }}>
                  <label>Nuevo canal</label>
                  <input className="input" name="name" placeholder="Nombre del canal" />
                </div>
                <div style={{ minWidth: 240, flex: 1 }}>
                  <LogoUploadField
                    name="logoUrl"
                    label="Logo del canal"
                    hint="Se usa en los links públicos de pago/débito automático."
                  />
                </div>
                <PendingButton className="primary" type="submit" pendingText="Creando...">
                  Crear canal
                </PendingButton>
              </form>
            </div>

            {tenants.length ? (
              <div className="stack">
                {tenants.map((tenant: any) => {
                  const tenantIdValue = String(tenant.id || "");
                  const isEditingTenant = openTenant === tenantIdValue;
                  const tenantLogo = tenant?.metadata?.logoUrl || tenant?.metadata?.brand?.logoUrl || "";
                  const editHref = `/settings?${new URLSearchParams({ tab: "canales", openTenant: tenantIdValue }).toString()}`;
                  const closeEditHref = `/settings?${new URLSearchParams({ tab: "canales" }).toString()}`;
                  return (
                    <div key={tenant.id} className="card cardPad">
                      {!isEditingTenant ? (
                        <>
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {tenantLogo ? (
                                <img src={tenantLogo} alt={tenant.name || "Canal"} style={{ height: 44, width: 44, borderRadius: 10, objectFit: "cover", border: "1px solid var(--stroke)" }} />
                              ) : (
                                <div style={{ height: 44, width: 44, borderRadius: 10, border: "1px dashed var(--stroke)", background: "var(--panel-soft)" }} />
                              )}
                              <div>
                                <strong>{tenant.name || "Canal"}</strong>
                                <div className="field-hint">
                                  Factor: {tenant?.metadata?.gamification?.factor ?? 1} · Bonus: {tenant?.metadata?.gamification?.bonus ?? 0}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <a className="ghost btn-compact btn-blue" href={editHref}>
                              Editar
                            </a>
                            <DeleteTenantButton action={deleteTenant} csrfToken={csrfToken} tenantId={tenant.id} returnTo={returnTo} />
                          </div>
                        </>
                      ) : (
                        <>
                          <form action={updateTenant} className="row" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <input type="hidden" name="csrfToken" value={csrfToken} />
                            <input type="hidden" name="tenantId" value={tenant.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <div className="field" style={{ minWidth: 240, flex: 1 }}>
                              <label>Nombre</label>
                              <input className="input" name="name" defaultValue={tenant.name || ""} />
                            </div>
                            <div style={{ minWidth: 240, flex: 1 }}>
                              <LogoUploadField name="logoUrl" label="Logo del canal" defaultValue={tenantLogo} />
                            </div>
                            <div className="field" style={{ minWidth: 200 }}>
                              <label>Factor gamificación</label>
                              <input className="input" name="gamificationFactor" type="number" step="0.01" defaultValue={tenant?.metadata?.gamification?.factor ?? 1} />
                            </div>
                            <div className="field" style={{ minWidth: 200 }}>
                              <label>Bonus gamificación</label>
                              <input className="input" name="gamificationBonus" type="number" step="1" defaultValue={tenant?.metadata?.gamification?.bonus ?? 0} />
                            </div>
                            <div className="field" style={{ minWidth: 200 }}>
                              <label>Follow-up (min)</label>
                              <input className="input" name="followupMinutes" type="number" defaultValue={tenant?.metadata?.gamification?.followupMinutes ?? ""} />
                            </div>
                            <div className="field" style={{ minWidth: 200 }}>
                              <label>Cooldown (min)</label>
                              <input className="input" name="followupCooldownMinutes" type="number" defaultValue={tenant?.metadata?.gamification?.followupCooldownMinutes ?? ""} />
                            </div>
                            <div className="field" style={{ minWidth: 200 }}>
                              <label>Máx. retomas</label>
                              <input className="input" name="followupMaxAttempts" type="number" defaultValue={tenant?.metadata?.gamification?.followupMaxAttempts ?? ""} />
                            </div>
                            <PendingButton className="ghost" type="submit" pendingText="Guardando...">
                              Guardar
                            </PendingButton>
                          </form>
                          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <a className="ghost btn-compact" href={closeEditHref}>
                              Cancelar
                            </a>
                            <DeleteTenantButton action={deleteTenant} csrfToken={csrfToken} tenantId={tenant.id} returnTo={returnTo} />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card cardPad">No hay canales creados.</div>
            )}
          </div>
        </section>
      ) : null}

    </main>
  );
}
