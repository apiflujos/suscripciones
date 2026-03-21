import "server-only";

import { LogLevel, CredentialProvider } from "@prisma/client";
import { clearCredential, getCredential, setCredential } from "@suscripciones/core/services/credentials";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { WompiClient } from "@suscripciones/core/providers/wompi/client";
import { getGlobalModuleAccess } from "@suscripciones/core/services/moduleAccess";
import { getShopifyForward } from "@suscripciones/core/services/runtimeConfig";
import { postJson } from "@suscripciones/core/lib/http";
import {
  envOnlySchema,
  wompiTestSchema,
  wompiUpdateSchema,
  shopifyUpdateSchema,
  chatwootUpdateSchema,
  autoDebitUpdateSchema,
  paymentsConfigUpdateSchema,
  aiUpdateSchema,
  aiDeleteSchema,
  checkoutConfigUpdateSchema,
  toBool,
  toInt,
  normalizeRetryUnit,
  retryUnitMultiplier,
  deriveRetryUnitAndValue,
  ActiveEnv
} from "../settings/_lib";

export async function updateWompiSettings(input: unknown) {
  const parsed = wompiUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const { environment, activeEnv, publicKey, privateKey, integritySecret, eventsSecret, apiBaseUrl, checkoutLinkBaseUrl, redirectUrl } =
    parsed.data;
  const env: ActiveEnv = environment || "PRODUCTION";

  try {
    if (activeEnv) await setCredential(CredentialProvider.WOMPI, "ACTIVE_ENV", activeEnv);
    if (publicKey) await setCredential(CredentialProvider.WOMPI, `PUBLIC_KEY_${env}`, publicKey);
    if (privateKey) await setCredential(CredentialProvider.WOMPI, `PRIVATE_KEY_${env}`, privateKey);
    if (integritySecret) await setCredential(CredentialProvider.WOMPI, `INTEGRITY_SECRET_${env}`, integritySecret);
    if (eventsSecret) await setCredential(CredentialProvider.WOMPI, `EVENTS_SECRET_${env}`, eventsSecret);
    if (apiBaseUrl) await setCredential(CredentialProvider.WOMPI, `API_BASE_URL_${env}`, apiBaseUrl);
    if (checkoutLinkBaseUrl) await setCredential(CredentialProvider.WOMPI, `CHECKOUT_LINK_BASE_URL_${env}`, checkoutLinkBaseUrl);
    if (redirectUrl != null) await setCredential(CredentialProvider.WOMPI, `REDIRECT_URL_${env}`, redirectUrl);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.wompi", "Credenciales de Wompi actualizadas").catch(() => {});
  return { ok: true as const };
}

export async function testWompiConnection(input: unknown) {
  const parsed = wompiTestSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
  const publicKeyInput = String(parsed.data.publicKey || "").trim();
  const apiBaseInput = String(parsed.data.apiBaseUrl || "").trim();

  const publicKey =
    publicKeyInput ||
    (await getCredential(CredentialProvider.WOMPI, `PUBLIC_KEY_${env}`)) ||
    (await getCredential(CredentialProvider.WOMPI, "PUBLIC_KEY")) ||
    "";
  const apiBaseUrl =
    apiBaseInput ||
    (await getCredential(CredentialProvider.WOMPI, `API_BASE_URL_${env}`)) ||
    (await getCredential(CredentialProvider.WOMPI, "API_BASE_URL")) ||
    (env === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://api.wompi.co/v1");

  if (!publicKey) {
    return { ok: false as const, status: 400, error: "wompi_public_key_not_configured" as const, message: "La llave pública no está configurada" };
  }

  try {
    const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl: "https://checkout.wompi.co/l/" });
    const merchantInfo = await wompi.getMerchant(publicKey);
    if (!merchantInfo || typeof merchantInfo !== "object") {
      throw new Error("Respuesta inválida de Wompi");
    }

    return {
      ok: true as const,
      message: `Conexión exitosa con ${env === "SANDBOX" ? "Sandbox" : "Producción"}`,
      environment: env
    };
  } catch (err: any) {
    const errorMsg = String(err?.message || err);
    let userMessage = errorMsg;
    if (errorMsg.includes("401") || errorMsg.includes("unauthorized")) {
      userMessage = "Llave pública inválida o expirada";
    } else if (errorMsg.includes("403")) {
      userMessage = "Acceso denegado - verifica tus credenciales";
    } else if (errorMsg.includes("ENOTFOUND") || errorMsg.includes("network")) {
      userMessage = "No se pudo conectar con Wompi - verifica tu conexión a internet";
    } else if (env === "SANDBOX" && errorMsg.includes("404")) {
      userMessage = "Endpoint de Sandbox no encontrado - verifica la URL base";
    }
    return { ok: false as const, status: 400, error: "wompi_test_failed" as const, message: userMessage };
  }
}

export async function deleteWompiSettings(input: unknown) {
  const parsed = envOnlySchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
  const keys = [
    `PUBLIC_KEY_${env}`,
    `PRIVATE_KEY_${env}`,
    `INTEGRITY_SECRET_${env}`,
    `EVENTS_SECRET_${env}`,
    `API_BASE_URL_${env}`,
    `CHECKOUT_LINK_BASE_URL_${env}`,
    `REDIRECT_URL_${env}`
  ];

  try {
    await Promise.all(keys.map((key) => clearCredential(CredentialProvider.WOMPI, key).catch(() => {})));
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.wompi", "Credenciales de Wompi eliminadas", { env }).catch(() => {});
  return { ok: true as const };
}

export async function updateShopifySettings(input: unknown) {
  const parsed = shopifyUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  try {
    if (parsed.data.forwardUrl != null) await setCredential(CredentialProvider.SHOPIFY, "FORWARD_URL", parsed.data.forwardUrl);
    if (parsed.data.forwardSecret != null) await setCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET", parsed.data.forwardSecret);
    if (parsed.data.forwardOrigin != null) {
      await setCredential(CredentialProvider.SHOPIFY, "FORWARD_ORIGIN", parsed.data.forwardOrigin);
    }
    if (parsed.data.forwardRetryEnabled != null) {
      await setCredential(
        CredentialProvider.SHOPIFY,
        "FORWARD_RETRY_ENABLED",
        String(parsed.data.forwardRetryEnabled).toLowerCase() === "false" ? "false" : "true"
      );
    }
    if (parsed.data.forwardRetryMinutes != null) {
      await setCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES", String(parsed.data.forwardRetryMinutes));
    }
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.reenvio", "Configuración de reenvío actualizada").catch(() => {});
  return { ok: true as const };
}

export async function deleteShopifySettings() {
  try {
    await Promise.all([
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_URL").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_ORIGIN").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_ENABLED").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES").catch(() => {})
    ]);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.reenvio", "Configuración de reenvío eliminada").catch(() => {});
  return { ok: true as const };
}

export async function testShopifyForward(input: unknown) {
  const schema = shopifyUpdateSchema.pick({ forwardUrl: true, forwardSecret: true, forwardOrigin: true });
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const stored = await getShopifyForward();
  const forwardUrl = parsed.data.forwardUrl || stored.url || "";
  const forwardSecret = parsed.data.forwardSecret || stored.secret || "";
  const origin = parsed.data.forwardOrigin || stored.origin || "shopify";

  if (!forwardUrl) return { ok: false as const, status: 400, error: "forward_not_configured" as const };

  const payload = {
    event: "wompi.forward.test",
    data: {
      origin,
      transaction: {
        id: "test_txn",
        origin,
        status: "APPROVED",
        amount_in_cents: 1000,
        currency: "COP",
        reference: "SHOPIFY_TEST"
      }
    },
    sent_at: new Date().toISOString(),
    timestamp: Date.now(),
    origin
  };

  const headers = {
    "x-forwarded-by": "wompi-subs-api",
    ...(forwardSecret ? { "x-forwarded-secret": forwardSecret } : {})
  } as Record<string, string>;

  const out = await postJson(forwardUrl, payload, headers);
  if (!out.ok) {
    return { ok: false as const, status: 400, error: "forward_failed" as const, details: { status: out.status, text: out.text } };
  }
  return { ok: true as const, status: out.status };
}

export async function updateChatwootSettings(input: unknown) {
  const parsed = chatwootUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  try {
    const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
    if (parsed.data.activeEnv) await setCredential(CredentialProvider.CHATWOOT, "ACTIVE_ENV", parsed.data.activeEnv);
    if (parsed.data.baseUrl != null) await setCredential(CredentialProvider.CHATWOOT, `BASE_URL_${env}`, parsed.data.baseUrl);
    if (parsed.data.accountId != null) await setCredential(CredentialProvider.CHATWOOT, `ACCOUNT_ID_${env}`, String(parsed.data.accountId));
    if (parsed.data.apiAccessToken != null)
      await setCredential(CredentialProvider.CHATWOOT, `API_ACCESS_TOKEN_${env}`, parsed.data.apiAccessToken);
    if (parsed.data.inboxId != null) await setCredential(CredentialProvider.CHATWOOT, `INBOX_ID_${env}`, String(parsed.data.inboxId));
    if (parsed.data.productTemplateName != null)
      await setCredential(CredentialProvider.CHATWOOT, `PRODUCT_TEMPLATE_NAME_${env}`, parsed.data.productTemplateName);
    if (parsed.data.productTemplateLang != null)
      await setCredential(CredentialProvider.CHATWOOT, `PRODUCT_TEMPLATE_LANG_${env}`, parsed.data.productTemplateLang);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.comunicaciones", "Credenciales de la central de comunicaciones actualizadas").catch(() => {});
  return { ok: true as const };
}

export async function deleteChatwootSettings(input: unknown) {
  const parsed = chatwootUpdateSchema.pick({ environment: true }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  try {
    const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
    await setCredential(CredentialProvider.CHATWOOT, `BASE_URL_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `ACCOUNT_ID_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `INBOX_ID_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `API_ACCESS_TOKEN_${env}`, "");
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.comunicaciones", "Credenciales de la central de comunicaciones eliminadas").catch(() => {});
  return { ok: true as const };
}

export async function updateAutoDebitConfig(input: unknown) {
  const parsed = autoDebitUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const currentRaw = (await getCredential(CredentialProvider.WOMPI, "AUTO_DEBIT_CONFIG")) || "";
  let current: any = {};
  try {
    current = currentRaw ? JSON.parse(currentRaw) : {};
  } catch {
    current = {};
  }

  const enabled = parsed.data.enabled != null ? toBool(parsed.data.enabled, true) : toBool(current?.enabled, true);
  const chargeAtCutoffEnabled =
    parsed.data.chargeAtCutoffEnabled != null
      ? toBool(parsed.data.chargeAtCutoffEnabled, true)
      : toBool(current?.chargeAtCutoffEnabled, true);
  const allowManualCharge =
    parsed.data.allowManualCharge != null ? toBool(parsed.data.allowManualCharge, true) : toBool(current?.allowManualCharge, true);
  const retryEnabled = parsed.data.retryEnabled != null ? toBool(parsed.data.retryEnabled, false) : toBool(current?.retryEnabled, false);
  const retryUnit = parsed.data.retryEveryUnit ? normalizeRetryUnit(parsed.data.retryEveryUnit) : normalizeRetryUnit(current?.retryEveryUnit);
  const retryValue =
    parsed.data.retryEveryValue != null ? toInt(parsed.data.retryEveryValue, 1, 1, 10080) : toInt(current?.retryEveryValue, 0, 0, 10080);
  const retryEveryMinutes =
    retryValue > 0
      ? toInt(retryValue * retryUnitMultiplier(retryUnit), 60, 1, 10080)
      : parsed.data.retryEveryMinutes != null
      ? toInt(parsed.data.retryEveryMinutes, 60, 1, 10080)
      : toInt(current?.retryEveryMinutes, 60, 1, 10080);
  const derived = deriveRetryUnitAndValue(retryEveryMinutes);
  const maxRetries = parsed.data.maxRetries != null ? toInt(parsed.data.maxRetries, 0, 0, 1) : toInt(current?.maxRetries, 0, 0, 1);

  await setCredential(
    CredentialProvider.WOMPI,
    "AUTO_DEBIT_CONFIG",
    JSON.stringify({
      enabled,
      chargeAtCutoffEnabled,
      allowManualCharge,
      retryEnabled,
      retryEveryValue: derived.retryEveryValue,
      retryEveryUnit: derived.retryEveryUnit,
      retryEveryMinutes,
      maxRetries
    })
  );
  await systemLog(LogLevel.INFO, "configuracion.auto_debito", "Configuración de débito automático actualizada", {
    enabled,
    chargeAtCutoffEnabled,
    allowManualCharge,
    retryEnabled,
    retryEveryValue: derived.retryEveryValue,
    retryEveryUnit: derived.retryEveryUnit,
    retryEveryMinutes,
    maxRetries
  }).catch(() => {});
  return { ok: true as const };
}

export async function updatePaymentsConfig(input: unknown) {
  const parsed = paymentsConfigUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const currentRaw = (await getCredential(CredentialProvider.WOMPI, "PAYMENTS_CONFIG")) || "";
  let current: any = {};
  try {
    current = currentRaw ? JSON.parse(currentRaw) : {};
  } catch {
    current = {};
  }

  const autoReconcileUnlinkedPayments =
    parsed.data.autoReconcileUnlinkedPayments != null
      ? toBool(parsed.data.autoReconcileUnlinkedPayments, true)
      : toBool(current?.autoReconcileUnlinkedPayments, true);
  const acceptUnlinkedPayments =
    parsed.data.acceptUnlinkedPayments != null ? toBool(parsed.data.acceptUnlinkedPayments, true) : toBool(current?.acceptUnlinkedPayments, true);
  const notifyWhatsappForUnlinkedPayments =
    parsed.data.notifyWhatsappForUnlinkedPayments != null
      ? toBool(parsed.data.notifyWhatsappForUnlinkedPayments, true)
      : toBool(current?.notifyWhatsappForUnlinkedPayments, true);
  const includeUnlinkedPaymentsInMetrics =
    parsed.data.includeUnlinkedPaymentsInMetrics != null
      ? toBool(parsed.data.includeUnlinkedPaymentsInMetrics, true)
      : toBool(current?.includeUnlinkedPaymentsInMetrics, true);

  await setCredential(
    CredentialProvider.WOMPI,
    "PAYMENTS_CONFIG",
    JSON.stringify({
      autoReconcileUnlinkedPayments,
      acceptUnlinkedPayments,
      notifyWhatsappForUnlinkedPayments,
      includeUnlinkedPaymentsInMetrics
    })
  );
  await systemLog(LogLevel.INFO, "configuracion.pagos", "Configuración de pagos actualizada", {
    autoReconcileUnlinkedPayments,
    acceptUnlinkedPayments,
    notifyWhatsappForUnlinkedPayments,
    includeUnlinkedPaymentsInMetrics
  }).catch(() => {});
  return { ok: true as const };
}

export async function updateCheckoutConfig(input: unknown) {
  const parsed = checkoutConfigUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const payload = {
    planBaseUrl: parsed.data.planBaseUrl || "",
    subscriptionBaseUrl: parsed.data.subscriptionBaseUrl || "",
    defaultUtmParams: parsed.data.defaultUtmParams || "",
    tokenExpiryHours: parsed.data.tokenExpiryHours || undefined,
    logoUrl: parsed.data.logoUrl || "",
    supportEmail: parsed.data.supportEmail || "",
    supportUrl: parsed.data.supportUrl || "",
    planTitle: parsed.data.planTitle || "",
    planDescription: parsed.data.planDescription || "",
    subscriptionTitle: parsed.data.subscriptionTitle || "",
    subscriptionDescription: parsed.data.subscriptionDescription || "",
    planWompiTitle: parsed.data.planWompiTitle || "",
    planWompiDescription: parsed.data.planWompiDescription || "",
    subscriptionWompiTitle: parsed.data.subscriptionWompiTitle || "",
    subscriptionWompiDescription: parsed.data.subscriptionWompiDescription || "",
    tokenizationSuccessTitle: parsed.data.tokenizationSuccessTitle || "",
    tokenizationSuccessMessage: parsed.data.tokenizationSuccessMessage || "",
    tokenizationErrorMessage: parsed.data.tokenizationErrorMessage || "",
    tokenizationReturnUrl: parsed.data.tokenizationReturnUrl || ""
  };

  await setCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG", JSON.stringify(payload));
  await systemLog(LogLevel.INFO, "settings.checkout_config", "Checkout config updated");
  return { ok: true as const };
}

export async function updateAiProvider(input: unknown) {
  const parsed = aiUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const aiAccess = await getGlobalModuleAccess("ai");
  if (!aiAccess.enabled) return { ok: false as const, status: 403, error: "ai_disabled" as const, reason: aiAccess.reason };

  const provider = parsed.data.provider;
  const credentialProvider = provider === "DEEPSEEK" ? CredentialProvider.DEEPSEEK : CredentialProvider.OPENAI;

  try {
    if (parsed.data.apiKey != null) await setCredential(credentialProvider, "API_KEY", parsed.data.apiKey);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.ia", "Configuración de IA actualizada", { provider }).catch(() => {});
  return { ok: true as const };
}

export async function deleteAiProvider(input: unknown) {
  const parsed = aiDeleteSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const aiAccess = await getGlobalModuleAccess("ai");
  if (!aiAccess.enabled) return { ok: false as const, status: 403, error: "ai_disabled" as const, reason: aiAccess.reason };

  const provider = parsed.data.provider;
  const credentialProvider = provider === "DEEPSEEK" ? CredentialProvider.DEEPSEEK : CredentialProvider.OPENAI;

  try {
    await clearCredential(credentialProvider, "API_KEY");
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.ia", "Configuración de IA eliminada", { provider }).catch(() => {});
  return { ok: true as const };
}
