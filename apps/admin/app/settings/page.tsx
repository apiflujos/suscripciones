import type { ReactNode } from "react";
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
  updateAiProvider,
  deleteAiProvider,
  updateAutoDebitConfig,
  updatePaymentsConfig,
  createWebhookEndpointAction,
  updateWebhookEndpointAction,
  deleteWebhookEndpointAction,
  createApiTokenAction,
  revokeApiTokenAction,
  updateSubscriptionConfig
} from "./actions";
import { normalizeErrorParam } from "../lib/errorParam";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";
import { AppearanceSelector } from "../ui/AppearanceSelector";
import { AutoSubmitOnChange } from "../ui/AutoSubmitOnChange";
import { AutoSubmitToggle } from "../ui/AutoSubmitToggle";
import { CopyButton } from "../ui/CopyButton";
import { getCsrfToken } from "../lib/csrf";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { LogoUploadField } from "./LogoUploadField";
import { CheckoutTemplatesPanel } from "../checkout-templates/CheckoutTemplatesPanel";
import { createCheckoutTemplate, updateCheckoutTemplate, deleteCheckoutTemplate, duplicateCheckoutTemplate, createCheckoutTemplateDefaults } from "../checkout-templates/actions";
import { RedirectConfigPanel } from "./RedirectConfigPanel";
import { createTenant, deleteTenant, updateTenant } from "../tenants/actions";
import { updateCheckoutConfig } from "./actions";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { UsersPanel } from "./UsersPanel";
import { UserNotificationsPanel } from "./UserNotificationsPanel";
import { WhatsappNotificationsPanel } from "./WhatsappNotificationsPanel";
import { WebhooksPanel } from "./WebhooksPanel";
import { getAdminSettings } from "../admin/_services/settings";
import { listCheckoutTemplates } from "../admin/_services/checkoutTemplates";
import { listCatalogProducts } from "../admin/_services/products";
import { listTenants } from "../admin/_services/tenants";
import { listAdminUsers } from "../admin/_services/adminUsers";
import { listWebhookEvents } from "../admin/_services/logs";
import { listWebhookEndpoints } from "../admin/_services/webhookEndpoints";
import { listApiTokens } from "../admin/_services/apiTokens";

export const dynamic = "force-dynamic";

function SettingsSectionHeader({
  title,
  hint,
  help
}: {
  title: string;
  hint?: string;
  help?: ReactNode;
}) {
  return (
    <div className="settings-section-header">
      <div className="settings-section-title">
        <h3>{title}</h3>
        {help ?? null}
      </div>
      {hint ? <div className="settings-section-hint">{hint}</div> : null}
    </div>
  );
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const csrfToken = await getCsrfToken();
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const settings = await getAdminSettings();
  const templates = await listCheckoutTemplates({ wantsAll: true });
  const productsRes = await listCatalogProducts({ take: 200, includeInactive: false });
  const tenants = (await listTenants()).filter((t: any) => t?.active !== false);
  const usersRes = await listAdminUsers(session);
  const users = usersRes.ok ? usersRes.items || [] : [];
  const products = productsRes.items || [];
  const wompiActiveEnv = (settings?.wompi?.activeEnv || "PRODUCTION") as "PRODUCTION" | "SANDBOX";
  const wompiProduction = (settings?.wompi?.production || settings?.wompi || {}) as any;
  const wompiSandbox = (settings?.wompi?.sandbox || {}) as any;

  const comms = (settings?.communications || null) as any;
  const commsProduction = (comms?.production || settings?.chatwoot || {}) as any;
  const appPublicBaseUrl = String(process.env.APP_PUBLIC_BASE_URL || "").trim();
  const webhookBase = appPublicBaseUrl ? appPublicBaseUrl.replace(/\/$/, "") : "";
  const webhookUrl = webhookBase ? `${webhookBase}/webhooks/wompi` : "";
  const docsBase = String(process.env.API_DOCS_URL || "https://mdv.sus.apiflujos.com").trim();
  const docsUrl = docsBase || (webhookBase ? `${webhookBase}/docs` : "");
  const swaggerUrl = String(process.env.API_SWAGGER_URL || "").trim() || (docsBase ? `${docsBase.replace(/\/$/, "")}/swagger` : webhookBase ? `${webhookBase}/swagger` : "");
  const ai = (settings?.ai || {}) as any;
  const aiProviders = (ai?.providers || {}) as any;
  const aiOpenai = (aiProviders?.openai || {}) as any;
  const aiDeepseek = (aiProviders?.deepseek || {}) as any;
  const autoDebit = (settings?.autoDebit || {}) as any;
  const paymentsConfig = (settings?.paymentsConfig || {}) as any;
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
  const retryValueOptions = [1, 2, 3, 4, 5, 10, 15, 20, 30, 45, 60];
  const maxRetriesOptions = [0, 1, 2, 3, 4, 5, 8, 10, 12, 15, 20];
  const retryEveryValue = Number(autoDebit?.retryEveryValue || 1);
  const retryEveryUnit = String(autoDebit?.retryEveryUnit || "MINUTES");
  const retryEveryMinutes = Number(autoDebit?.retryEveryMinutes || 60);
  const sp = (await searchParams) ?? {};
  const action = String(sp.a || "");
  const status = String(sp.status || "");
  const errorText = normalizeErrorParam(typeof sp.error === "string" ? sp.error : undefined);
  const rawTab = String(sp.tab || "connections");
  const tab = rawTab === "webhooks" ? "integraciones" : rawTab;
  const open = String(sp.open || "");
  const envRaw = String(sp.env || "");
  const env = envRaw.toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  const notifSaved = typeof sp.saved === "string" ? sp.saved : "";
  const notifScheduled = typeof sp.scheduled === "string" ? sp.scheduled : "";
  const notifError = typeof sp.error === "string" ? sp.error : "";
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
  const tenantId = String(session?.tenantId || "").trim() || String(tenants?.[0]?.id || "").trim();
  let webhookEndpoints: any[] = [];
  if (tenantId) {
    try {
      webhookEndpoints = await listWebhookEndpoints(tenantId);
    } catch {
      webhookEndpoints = [];
    }
  }
  const apiTokens = tenantId ? await listApiTokens(tenantId) : [];
  const webhookEvents = tenantId ? await listWebhookEvents({ tenantId, take: 25 }) : { items: [] as any[] };
  const wompiLastEvent = (webhookEvents.items || []).find((e: any) => String(e?.provider || "") === "WOMPI") || null;
  const wompiLastEventAt = wompiLastEvent?.receivedAt || null;
  const renderInline = (actionKey: string, okText: string, failPrefix: string) => {
    if (action !== actionKey) return null;
    if (status === "ok") return <div className="field-hint is-success">{okText}</div>;
    if (status === "fail") return <div className="field-hint" style={{ color: "var(--danger)" }}>{failPrefix}: {errorText || "unknown_error"}</div>;
    return null;
  };
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
  const wompiEventsSecretMasked = maskSecret(
    wompiActiveEnv === "SANDBOX" ? String(wompiSandbox?.eventsSecret || "") : String(wompiProduction?.eventsSecret || "")
  );

  return (
    <main className="page pageWide settingsPage">
      <div className="settings-tabs">
        <a className={`settings-tab ${tab === "connections" ? "is-active" : ""}`} href="/settings?tab=connections" title="Integraciones y conexiones externas">
          Conexiones
        </a>
        <a className={`settings-tab ${tab === "cobros" ? "is-active" : ""}`} href="/settings?tab=cobros" title="Configuración de cobros y pagos">
          Cobros
        </a>
        <a className={`settings-tab ${tab === "suscripciones" ? "is-active" : ""}`} href="/settings?tab=suscripciones" title="Configuración de suscripciones">
          Suscripciones
        </a>
        <a className={`settings-tab ${tab === "checkout-publico" ? "is-active" : ""}`} href="/settings?tab=checkout-publico" title="Plantillas y configuración del checkout público">
          Checkout público
        </a>
        <a className={`settings-tab ${tab === "canales" ? "is-active" : ""}`} href="/settings?tab=canales" title="Canales de venta y asignación de tenants">
          Canales de venta
        </a>
        <a className={`settings-tab ${tab === "usuarios" ? "is-active" : ""}`} href="/settings?tab=usuarios" title="Gestión de usuarios y roles">
          Usuarios
        </a>
        <a className={`settings-tab ${tab === "notificaciones" ? "is-active" : ""}`} href="/settings?tab=notificaciones" title="Notificaciones del sistema">
          Notificaciones del sistema
        </a>
        <a className={`settings-tab ${tab === "notificaciones-whatsapp" ? "is-active" : ""}`} href="/settings?tab=notificaciones-whatsapp" title="Configuración de notificaciones WhatsApp">
          Notificaciones WhatsApp
        </a>
        <a className={`settings-tab ${tab === "apariencia" ? "is-active" : ""}`} href="/settings?tab=apariencia" title="Tema, logo y apariencia general">
          Apariencia
        </a>
        <a className={`settings-tab ${tab === "integraciones" ? "is-active" : ""}`} href="/settings?tab=integraciones" title="Integraciones, webhooks y API">
          Integraciones
        </a>
      </div>

      {!settings?.encryptionKeyConfigured ? (
        <div className="card cardPad">
          Falta `CREDENTIALS_ENCRYPTION_KEY_B64` en el API (Base64 de 32 bytes). Sin esto no se guardan secretos. Usa el mismo valor también en el servicio de jobs (`wompi-subs-jobs`).
        </div>
      ) : null}

      {settings?.encryptionKeyConfigured && settings?.encryptionKeyValid === false ? (
        <div className="card cardPad">
          `CREDENTIALS_ENCRYPTION_KEY_B64` está configurada pero es inválida. Debe ser Base64 de <strong>32 bytes</strong> (no 32 caracteres).
        </div>
      ) : null}

      {tab === "apariencia" ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="settings-group-header-main">
              <SettingsSectionHeader title="Apariencia" hint="Tema, visión y contraste." />
            </div>
          </div>
          <div className="settings-group-body">
            <AppearanceSelector cards />
          </div>
        </section>
      ) : null}

      {tab === "usuarios" ? (
        <UsersPanel
          users={users}
          csrfToken={csrfToken}
          created={String(sp.created) === "1"}
          error={normalizeErrorParam(typeof sp.error === "string" ? sp.error : undefined)}
          tenants={tenants}
          isSuperAdmin={session?.role === "SUPER_ADMIN"}
          defaultTenantId={String(session?.tenantId || "").trim()}
        />
      ) : null}

      {tab === "notificaciones" ? (
        <UserNotificationsPanel isSuperAdmin={session?.role === "SUPER_ADMIN"} />
      ) : null}

      {tab === "notificaciones-whatsapp" ? (
        <WhatsappNotificationsPanel
          env={env}
          saved={notifSaved}
          scheduled={notifScheduled}
          error={notifError}
        />
      ) : null}

      {tab === "integraciones" ? (
        <WebhooksPanel
          csrfToken={csrfToken}
          baseUrl={webhookBase}
          wompiUrl={webhookUrl}
          wompiActiveEnv={wompiActiveEnv}
          wompiEventsSecretMasked={wompiEventsSecretMasked}
          wompiLastEventAt={wompiLastEventAt}
          endpoints={webhookEndpoints}
          apiTokens={apiTokens}
          docsUrl={docsUrl}
          swaggerUrl={swaggerUrl}
          openId={open || null}
          createdToken={String(sp.token || "")}
          inlineState={inlineState}
          returnTo={returnTo}
          actions={{
            createWebhookEndpointAction: createWebhookEndpointAction,
            updateWebhookEndpointAction: updateWebhookEndpointAction,
            deleteWebhookEndpointAction: deleteWebhookEndpointAction,
            createApiTokenAction: createApiTokenAction,
            revokeApiTokenAction: revokeApiTokenAction
          }}
        />
      ) : null}

      {tab === "connections" ? (
        <>
          <section className="settings-group">
            <div className="settings-group-header">
              <div className="settings-group-header-main">
                <SettingsSectionHeader
                  title="Conexiones"
                  help={<HelpTip text="Abre cada conexión para configurar sus credenciales." />}
                />
              </div>
            </div>
            <div className="settings-group-body">
              <ConnectionsPanel
                csrfToken={csrfToken}
                wompiActiveEnv={wompiActiveEnv}
                wompiProduction={wompiProduction}
                wompiSandbox={wompiSandbox}
                commsProduction={commsProduction}
                shopify={settings?.shopify || {}}
                actions={{
                  setWompiActiveEnv,
                  updateWompi,
                  testWompiConnection,
                  deleteWompiConnection,
                  updateChatwoot,
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
              <div className="settings-group-header-main">
                <SettingsSectionHeader
                  title="Conexiones guardadas"
                  help={<HelpTip text="Resumen de las conexiones actuales." />}
                />
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
                      <form action={deleteWompiConnection}>
                        <input type="hidden" name="csrf" value={csrfToken} />
                        <input type="hidden" name="environment" value={envKey} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar conexión" title="Eliminar conexión" />
                      </form>
                    </div>
                    <div className="field-hint">Prueba la conexión desde el modal de edición.</div>
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

                <div className="saved-conn-card">
                  <div className="saved-conn-header">
                    <div>
                      <strong>Central · Chatwoot</strong>
                      <div className="saved-conn-sub">{commsProduction?.baseUrl && commsProduction?.accountId && commsProduction?.inboxId ? "Configurada" : "Sin configurar"}</div>
                    </div>
                    <span
                      className={`pill ${
                        commsProduction?.baseUrl && commsProduction?.accountId && commsProduction?.inboxId ? "pill-green" : "pill-muted"
                      }`}
                    >
                      {commsProduction?.baseUrl && commsProduction?.accountId && commsProduction?.inboxId ? "Activa" : "Inactiva"}
                    </span>
                  </div>
                  <div className="saved-conn-actions">
                    <a className="ghost btn-compact btn-blue" href="/settings?tab=connections&open=central">Editar</a>
                    <form action={deleteCentralConnection}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="environment" value="PRODUCTION" />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar conexión" title="Eliminar conexión" />
                    </form>
                  </div>
                  <div className="field-hint">Prueba la conexión desde el modal de edición.</div>
                  <div className="saved-conn-meta">
                    <div className="saved-conn-meta-item">
                      <span className="saved-conn-meta-label">Base URL</span>
                      <span className="saved-conn-meta-value">{commsProduction?.baseUrl || "—"}</span>
                    </div>
                    <div className="saved-conn-meta-item">
                      <span className="saved-conn-meta-label">Cuenta</span>
                      <span className="saved-conn-meta-value">{commsProduction?.accountId || "—"}</span>
                    </div>
                    <div className="saved-conn-meta-item">
                      <span className="saved-conn-meta-label">Bandeja</span>
                      <span className="saved-conn-meta-value">{commsProduction?.inboxId || "—"}</span>
                    </div>
                  </div>
                </div>

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
                    <form action={deleteShopifyConnection}>
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar conexión" title="Eliminar conexión" />
                    </form>
                  </div>
                  <div className="field-hint">Prueba el forward desde el modal de edición.</div>
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
                <div className="settings-group-header-main">
                  <SettingsSectionHeader
                    title="Inteligencia artificial"
                    help={<HelpTip text="Configura una o ambas llaves. Si una falla, usamos la otra automáticamente." />}
                  />
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
                      <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar canal" title="Eliminar canal" />
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
                      <button className="ghost btn-compact btn-red btn-delete-icon" type="submit" aria-label="Eliminar checkout público" title="Eliminar checkout público" />
                    </form>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="settings-group">
              <div className="settings-group-header">
                <div className="settings-group-header-main">
                  <SettingsSectionHeader
                    title="Inteligencia artificial"
                    help={<HelpTip text="Esta sección requiere habilitación del super admin." />}
                  />
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

      {tab === "cobros" ? (
        <>
          <AutoSubmitOnChange />
          <section className="settings-group">
            <div className="settings-group-header">
              <div className="settings-group-header-main">
                <SettingsSectionHeader
                  title="Reglas de cobro"
                  help={<HelpTip text="Configura las reglas de cobro automático, corte, cobro manual y reintentos." />}
                />
              </div>
            </div>
            <div className="settings-group-body">
              <form action={updatePaymentsConfig} className="panel module" style={{ display: "grid", gap: 12 }} data-auto-submit-form="true">
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <div className="settings-submodule-header">
                  <div className="settings-submodule-title">Pagos sin suscripción</div>
                  <div className="field-hint">Reglas para pagos que llegan sin suscripción activa asociada.</div>
                </div>

                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Conciliación automática de pagos no asociados</strong>
                      <HelpTip text="Cuando un pago llega sin suscripción, intenta asociarlo automáticamente por nombre, email/teléfono y valor. Útil para pagos que llegan “huérfanos”." />
                    </div>
                    <div className="field-hint">Pagos sin suscripción activa: buscar coincidencia por identidad + monto.</div>
                  </div>
                  <label className="toggleControl" aria-label="Conciliación automática de pagos">
                    <input type="hidden" name="autoReconcileUnlinkedPayments" value="0" />
                    <input
                      className="toggleInput"
                      type="checkbox"
                      name="autoReconcileUnlinkedPayments"
                      value="1"
                      defaultChecked={Boolean(paymentsConfig?.autoReconcileUnlinkedPayments ?? true)}
                      data-auto-submit="true"
                    />
                    <span className="toggle" aria-hidden="true" />
                  </label>
                </div>

                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Aceptar pagos sin suscripción activa</strong>
                      <HelpTip text="Si lo apagas, los pagos que no se puedan asociar se marcan como ignorados y no aparecen en Pagos ni disparan notificaciones." />
                    </div>
                    <div className="field-hint">Pagos que llegan “sin nada” o no corresponden a ninguna suscripción.</div>
                  </div>
                  <label className="toggleControl" aria-label="Recibir pagos sin suscripción activa">
                    <input type="hidden" name="acceptUnlinkedPayments" value="0" />
                    <input
                      className="toggleInput"
                      type="checkbox"
                      name="acceptUnlinkedPayments"
                      value="1"
                      defaultChecked={Boolean(paymentsConfig?.acceptUnlinkedPayments ?? true)}
                      data-auto-submit="true"
                    />
                    <span className="toggle" aria-hidden="true" />
                  </label>
                </div>

                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Notificar por WhatsApp pagos no asociados</strong>
                      <HelpTip text="Controla si se envían notificaciones de pago (aprobado/fallido) cuando el pago no tiene suscripción asociada." />
                    </div>
                    <div className="field-hint">Aplica solo a pagos sin `subscriptionId`.</div>
                  </div>
                  <label className="toggleControl" aria-label="Notificar por WhatsApp estos pagos">
                    <input type="hidden" name="notifyWhatsappForUnlinkedPayments" value="0" />
                    <input
                      className="toggleInput"
                      type="checkbox"
                      name="notifyWhatsappForUnlinkedPayments"
                      value="1"
                      defaultChecked={Boolean(paymentsConfig?.notifyWhatsappForUnlinkedPayments ?? true)}
                      data-auto-submit="true"
                    />
                    <span className="toggle" aria-hidden="true" />
                  </label>
                </div>

                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Incluir pagos no asociados en métricas</strong>
                      <HelpTip text="Si lo apagas, los pagos sin suscripción activa no cuentan en las métricas del dashboard." />
                    </div>
                    <div className="field-hint">Impacta “Pagos OK/Fallidos” y “Revenue”.</div>
                  </div>
                  <label className="toggleControl" aria-label="Incluir estos pagos en métricas">
                    <input type="hidden" name="includeUnlinkedPaymentsInMetrics" value="0" />
                    <input
                      className="toggleInput"
                      type="checkbox"
                      name="includeUnlinkedPaymentsInMetrics"
                      value="1"
                      defaultChecked={Boolean(paymentsConfig?.includeUnlinkedPaymentsInMetrics ?? true)}
                      data-auto-submit="true"
                    />
                    <span className="toggle" aria-hidden="true" />
                  </label>
                </div>

                <div className="settings-submodule-header" style={{ marginTop: 8 }}>
                  <div className="settings-submodule-title">Ciclos y mora (por defecto)</div>
                  <div className="field-hint">Días del mes para inicio de ciclo, pago y días de gracia.</div>
                </div>

                <div className="grid2" style={{ gap: 12 }}>
                  <label className="field">
                    <span>Día inicio de ciclo</span>
                    <select className="select" name="defaultCycleStartDay" defaultValue={String(paymentsConfig?.defaultCycleStartDay ?? 1)}>
                      {Array.from({ length: 31 }).map((_, i) => (
                        <option key={`cycle-start-${i + 1}`} value={String(i + 1)}>{i + 1}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Día de pago</span>
                    <select className="select" name="defaultPaymentDay" defaultValue={String(paymentsConfig?.defaultPaymentDay ?? 1)}>
                      {Array.from({ length: 31 }).map((_, i) => (
                        <option key={`pay-day-${i + 1}`} value={String(i + 1)}>{i + 1}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid2" style={{ gap: 12 }}>
                  <label className="field">
                    <span>Tipo de pago</span>
                    <select className="select" name="defaultPaymentTiming" defaultValue={String(paymentsConfig?.defaultPaymentTiming || "EN_CURSO")}>
                      <option value="EN_CURSO">En curso</option>
                      <option value="ANTICIPADO">Anticipado</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Días de gracia</span>
                    <select className="select" name="defaultGraceDays" defaultValue={String(paymentsConfig?.defaultGraceDays ?? 1)}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <option key={`grace-${i + 1}`} value={String(i + 1)}>{i + 1}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </form>
            </div>
          </section>

          <section className="settings-group">
            <div className="settings-group-header">
              <div className="settings-group-header-main">
                <SettingsSectionHeader
                  title="Débito automático"
                  help={<HelpTip text="Cobros automáticos, corte, botón manual y reintentos." />}
                />
              </div>
            </div>
            <div className="settings-group-body">
              <form action={updateAutoDebitConfig} className="panel module" style={{ display: "grid", gap: 12 }} data-auto-submit-form="true" id="auto-debit-form">
                <input type="hidden" name="csrf" value={csrfToken} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Cobros automáticos</strong>
                      <HelpTip text="Si está apagado, no se realizan cargos automáticos." />
                    </div>
                    <div className="field-hint">Controla la ejecución de cobros recurrentes.</div>
                  </div>
                  <AutoSubmitToggle
                    name="enabled"
                    checked={Boolean(autoDebit?.enabled)}
                    requireConfirm={true}
                    confirmMessage="¿Seguro de cambiar cobros automáticos? Esto activará/desactivará todos los cobros recurrentes."
                    loadingText="Actualizando..."
                    form="auto-debit-form"
                  />
                </div>
                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Cobrar en fecha/hora de corte</strong>
                      <HelpTip text="Si lo apagas, no se encolan cobros por vencimiento automático." />
                    </div>
                    <div className="field-hint">Solo aplica cuando hay corte configurado.</div>
                  </div>
                  <AutoSubmitToggle
                    name="chargeAtCutoffEnabled"
                    checked={Boolean(autoDebit?.chargeAtCutoffEnabled ?? true)}
                    requireConfirm={true}
                    confirmMessage="¿Seguro de cambiar cobro en fecha de corte? Esto afecta cuándo se ejecutan los cobros automáticos."
                    loadingText="Actualizando..."
                    form="auto-debit-form"
                  />
                </div>
                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Habilitar botón de cobro manual</strong>
                      <HelpTip text="Permite ejecutar cobros manuales desde el panel." />
                    </div>
                    <div className="field-hint">Útil para cobros puntuales o casos especiales.</div>
                  </div>
                  <AutoSubmitToggle
                    name="allowManualCharge"
                    checked={Boolean(autoDebit?.allowManualCharge ?? true)}
                    loadingText="Actualizando..."
                    form="auto-debit-form"
                  />
                </div>
                <div className="toggleRow">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>Reintentos</strong>
                      <HelpTip text="Activa los reintentos automáticos cuando un cobro falla." />
                    </div>
                    <div className="field-hint">Configura el intervalo y el máximo abajo.</div>
                  </div>
                  <AutoSubmitToggle
                    name="retryEnabled"
                    checked={Boolean(autoDebit?.retryEnabled)}
                    requireConfirm={true}
                    confirmMessage="¿Seguro de cambiar reintentos? Esto activará/desactivará los cobros automáticos cuando fallen."
                    loadingText="Actualizando..."
                    form="auto-debit-form"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field">
                    <label>Reintentar cada</label>
                    <select className="select" name="retryEveryValue" defaultValue={String(retryEveryValue)} data-auto-submit="true">
                      {retryValueOptions.map((value) => (
                        <option key={`retry-every-${value}`} value={String(value)}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Unidad de reintento</label>
                    <select className="select" name="retryEveryUnit" defaultValue={String(retryEveryUnit)} data-auto-submit="true">
                      <option value="SECONDS">Segundos</option>
                      <option value="MINUTES">Minutos</option>
                      <option value="HOURS">Horas</option>
                      <option value="DAYS">Días</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field">
                    <label>Intervalo equivalente (minutos)</label>
                    <input className="input" type="text" value={retryEveryMinutes} readOnly />
                  </div>
                  <div className="field">
                    <label>Máximo de reintentos</label>
                    <select className="select" name="maxRetries" defaultValue={String(autoDebit?.maxRetries ?? 0)} data-auto-submit="true">
                      {maxRetriesOptions.map((value) => (
                        <option key={`retry-max-${value}`} value={String(value)}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field-hint">
                  Si cobros automáticos está apagado, no se hacen cargos automáticos.
                  Si apagas fecha de corte, no se encolan cobros por vencimiento automático.
                </div>
              </form>
            </div>
          </section>
        </>
      ) : null}

      {tab === "suscripciones" ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="settings-group-header-main">
              <SettingsSectionHeader title="Configuración de Suscripciones" />
            </div>
          </div>
          <div className="settings-group-body">
            <form action={updateSubscriptionConfig} className="panel module" style={{ display: "grid", gap: 16 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={`/settings?${new URLSearchParams({ tab: "suscripciones" }).toString()}`} />
              
              <div style={{ display: "grid", gap: 12 }}>
                <h4 style={{ margin: 0, fontSize: 14 }}>Tiempos de mora y suspensión</h4>
                <p className="field-hint" style={{ margin: 0 }}>Estos valores aplican para TODAS las suscripciones (se pueden sobrescribir por suscripción individual)</p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <div className="field">
                  <label className="field-label">
                    Días de gracia
                    <HelpTip text="Días después del vencimiento donde la suscripción está en gracia (no en mora)" />
                  </label>
                  <select className="select" name="graceDays" defaultValue={String(autoDebit?.graceDays ?? 5)}>
                    {Array.from({ length: 16 }, (_, i) => i).map((days) => (
                      <option key={days} value={days}>{days} días</option>
                    ))}
                  </select>
                  <div className="field-hint">Durante este período el badge es NARANJA "En gracia"</div>
                </div>

                <div className="field">
                  <label className="field-label">
                    Suspender después de
                    <HelpTip text="Días después del vencimiento cuando se suspende la suscripción" />
                  </label>
                  <select className="select" name="suspendDays" defaultValue={String(autoDebit?.suspendDays ?? 15)}>
                    {Array.from({ length: 31 }, (_, i) => i + 10).map((days) => (
                      <option key={days} value={days}>{days} días</option>
                    ))}
                  </select>
                  <div className="field-hint">Después de los días de gracia,badge ROJO "En mora"</div>
                </div>

                <div className="field">
                  <label className="field-label">
                    Cancelar después de
                    <HelpTip text="Días después de suspendido cuando se cancela la suscripción" />
                  </label>
                  <select className="select" name="cancelDays" defaultValue={String(autoDebit?.cancelDays ?? 30)}>
                    {Array.from({ length: 31 }, (_, i) => i + 20).map((days) => (
                      <option key={days} value={days}>{days} días</option>
                    ))}
                  </select>
                  <div className="field-hint">Badge GRIS "Cancelada"</div>
                </div>
              </div>

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end" }}>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar configuración
                </PendingButton>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {tab === "checkout-publico" ? (
        <section className="settings-group">
          <div className="settings-group-header">
            <div className="settings-group-header-main">
              <SettingsSectionHeader
                title="Checkout público"
                help={<HelpTip text="Crea plantillas de checkout para planes y suscripciones." />}
              />
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
            <div className="settings-group-header-main">
              <SettingsSectionHeader
                title="Canales de venta"
                help={<HelpTip text="Gestiona los canales (tenants) disponibles en la app." />}
              />
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
