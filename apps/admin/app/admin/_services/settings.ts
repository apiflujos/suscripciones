import "server-only";

import { CredentialProvider } from "@prisma/client";
import { getCredential, getCredentialsBulk } from "@suscripciones/core/services/credentials";
import { getGlobalModuleAccess } from "@suscripciones/core/services/moduleAccess";
import { readCheckoutConfig } from "@suscripciones/core/services/checkoutConfig";
import { getCheckoutBaseUrlsFromEnv, getPublicReturnUrlFromEnv } from "@suscripciones/core/services/publicBase";
import { logger } from "@suscripciones/core/lib/logger";
import { ActiveEnv, maskSecret, toBool, toInt, deriveRetryUnitAndValue } from "../settings/_lib";

export async function getCheckoutConfig() {
  const checkoutConfigRaw = await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG");
  const checkoutConfig = readCheckoutConfig(checkoutConfigRaw);

  const envBases = getCheckoutBaseUrlsFromEnv();
  const storedPlanBaseUrl = String(checkoutConfig?.planBaseUrl || "").trim();
  const storedSubscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const storedCartBaseUrl = String(checkoutConfig?.cartBaseUrl || "").trim();
  const storedReturnUrl = String(checkoutConfig?.tokenizationReturnUrl || "").trim();
  const timeZone = String(checkoutConfig?.timeZone || checkoutConfig?.timezone || "").trim();

  return {
    planBaseUrl: storedPlanBaseUrl || envBases.planBaseUrl,
    subscriptionBaseUrl: storedSubscriptionBaseUrl || envBases.subscriptionBaseUrl,
    cartBaseUrl: storedCartBaseUrl || envBases.cartBaseUrl,
    defaultUtmParams: String(checkoutConfig?.defaultUtmParams || ""),
    tokenExpiryHours: Number(checkoutConfig?.tokenExpiryHours || 24),
    timeZone: timeZone || "America/Bogota",
    tokenizationReturnUrl: storedReturnUrl || getPublicReturnUrlFromEnv(),
    defaultPlanTemplateId: String(checkoutConfig?.defaultPlanTemplateId || "").trim(),
    defaultSubscriptionTemplateId: String(checkoutConfig?.defaultSubscriptionTemplateId || "").trim(),
    defaultCartTemplateId: String(checkoutConfig?.defaultCartTemplateId || "").trim()
  };
}

export async function getAdminSettings() {
  const encKeyB64 = (process.env.CREDENTIALS_ENCRYPTION_KEY_B64 || "").trim();
  const encryptionKeyConfigured = !!encKeyB64;
  let encryptionKeyValid = false;
  if (encryptionKeyConfigured) {
    const buf = Buffer.from(encKeyB64, "base64");
    encryptionKeyValid = buf.length === 32;
  }

  const [wompiCreds, shopifyCreds, commsCreds, checkoutConfigRaw, openAiCreds, deepseekCreds, aiAccess] = await Promise.all([
    getCredentialsBulk(CredentialProvider.WOMPI, [
      "ACTIVE_ENV",
      "PUBLIC_KEY",
      "PRIVATE_KEY",
      "INTEGRITY_SECRET",
      "EVENTS_SECRET",
      "API_BASE_URL",
      "CHECKOUT_LINK_BASE_URL",
      "REDIRECT_URL",
      "PUBLIC_KEY_PRODUCTION",
      "PRIVATE_KEY_PRODUCTION",
      "INTEGRITY_SECRET_PRODUCTION",
      "EVENTS_SECRET_PRODUCTION",
      "API_BASE_URL_PRODUCTION",
      "CHECKOUT_LINK_BASE_URL_PRODUCTION",
      "REDIRECT_URL_PRODUCTION",
      "PUBLIC_KEY_SANDBOX",
      "PRIVATE_KEY_SANDBOX",
      "INTEGRITY_SECRET_SANDBOX",
      "EVENTS_SECRET_SANDBOX",
      "API_BASE_URL_SANDBOX",
      "CHECKOUT_LINK_BASE_URL_SANDBOX",
      "REDIRECT_URL_SANDBOX",
      "AUTO_DEBIT_CONFIG",
      "PAYMENTS_CONFIG"
    ]),
    getCredentialsBulk(CredentialProvider.SHOPIFY, [
      "FORWARD_URL",
      "FORWARD_SECRET",
      "FORWARD_ORIGIN",
      "FORWARD_RETRY_ENABLED",
      "FORWARD_RETRY_MINUTES"
    ]),
    getCredentialsBulk(CredentialProvider.CHATWOOT, [
      "ACTIVE_ENV",
      "BASE_URL",
      "ACCOUNT_ID",
      "INBOX_ID",
      "API_ACCESS_TOKEN",
      "PRODUCT_TEMPLATE_NAME",
      "PRODUCT_TEMPLATE_LANG",
      "BASE_URL_PRODUCTION",
      "ACCOUNT_ID_PRODUCTION",
      "INBOX_ID_PRODUCTION",
      "API_ACCESS_TOKEN_PRODUCTION",
      "PRODUCT_TEMPLATE_NAME_PRODUCTION",
      "PRODUCT_TEMPLATE_LANG_PRODUCTION",
      "BASE_URL_SANDBOX",
      "ACCOUNT_ID_SANDBOX",
      "INBOX_ID_SANDBOX",
      "API_ACCESS_TOKEN_SANDBOX",
      "PRODUCT_TEMPLATE_NAME_SANDBOX",
      "PRODUCT_TEMPLATE_LANG_SANDBOX"
    ]),
    getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG"),
    getCredentialsBulk(CredentialProvider.OPENAI, ["API_KEY"]),
    getCredentialsBulk(CredentialProvider.DEEPSEEK, ["API_KEY"]),
    getGlobalModuleAccess("ai")
  ]);

  const wompiActiveEnv = (() => {
    const fromDb = wompiCreds.get("ACTIVE_ENV");
    const normalized = String(fromDb || "PRODUCTION")
      .trim()
      .toUpperCase();
    return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  })() as ActiveEnv;

  const chatwootActiveEnv = (() => {
    const fromDb = commsCreds.get("ACTIVE_ENV");
    const normalized = String(fromDb || "PRODUCTION")
      .trim()
      .toUpperCase();
    return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  })() as ActiveEnv;

  const getWompi = (key: string, env: ActiveEnv) => (wompiCreds.get(`${key}_${env}`) || wompiCreds.get(key)) || undefined;
  const getComms = (key: string, env: ActiveEnv) => (commsCreds.get(`${key}_${env}`) || commsCreds.get(key)) || undefined;

  const wompiProd = {
    publicKey: getWompi("PUBLIC_KEY", "PRODUCTION") ?? null,
    privateKey: maskSecret(getWompi("PRIVATE_KEY", "PRODUCTION")),
    integritySecret: maskSecret(getWompi("INTEGRITY_SECRET", "PRODUCTION")),
    eventsSecret: maskSecret(getWompi("EVENTS_SECRET", "PRODUCTION")),
    apiBaseUrl: getWompi("API_BASE_URL", "PRODUCTION") ?? null,
    checkoutLinkBaseUrl: getWompi("CHECKOUT_LINK_BASE_URL", "PRODUCTION") ?? null,
    redirectUrl: getWompi("REDIRECT_URL", "PRODUCTION") ?? null
  };

  const wompiSandbox = {
    publicKey: getWompi("PUBLIC_KEY", "SANDBOX") ?? null,
    privateKey: maskSecret(getWompi("PRIVATE_KEY", "SANDBOX")),
    integritySecret: maskSecret(getWompi("INTEGRITY_SECRET", "SANDBOX")),
    eventsSecret: maskSecret(getWompi("EVENTS_SECRET", "SANDBOX")),
    apiBaseUrl: getWompi("API_BASE_URL", "SANDBOX") ?? null,
    checkoutLinkBaseUrl: getWompi("CHECKOUT_LINK_BASE_URL", "SANDBOX") ?? null,
    redirectUrl: getWompi("REDIRECT_URL", "SANDBOX") ?? null
  };

  const shopifyForwardUrl = shopifyCreds.get("FORWARD_URL") || undefined;
  const shopifyForwardOrigin = (shopifyCreds.get("FORWARD_ORIGIN") || "shopify").trim();
  const shopifyForwardRetryEnabledRaw = shopifyCreds.get("FORWARD_RETRY_ENABLED") || "";
  const shopifyForwardRetryEnabled = shopifyForwardRetryEnabledRaw
    ? String(shopifyForwardRetryEnabledRaw).toLowerCase() !== "false"
    : true;
  const shopifyForwardRetryMinutesRaw = shopifyCreds.get("FORWARD_RETRY_MINUTES") || "";
  const shopifyForwardRetryMinutesNum = Number(shopifyForwardRetryMinutesRaw);
  const shopifyForwardRetryMinutes =
    Number.isFinite(shopifyForwardRetryMinutesNum) && shopifyForwardRetryMinutesNum > 0
      ? Math.min(Math.max(Math.trunc(shopifyForwardRetryMinutesNum), 5), 1440)
      : 15;

  const commsProd = {
    baseUrl: getComms("BASE_URL", "PRODUCTION") ?? null,
    accountId: getComms("ACCOUNT_ID", "PRODUCTION") ?? null,
    inboxId: getComms("INBOX_ID", "PRODUCTION") ?? null,
    productTemplateName: getComms("PRODUCT_TEMPLATE_NAME", "PRODUCTION") ?? null,
    productTemplateLang: getComms("PRODUCT_TEMPLATE_LANG", "PRODUCTION") ?? null
  };

  const commsSandbox = {
    baseUrl: getComms("BASE_URL", "SANDBOX") ?? null,
    accountId: getComms("ACCOUNT_ID", "SANDBOX") ?? null,
    inboxId: getComms("INBOX_ID", "SANDBOX") ?? null,
    productTemplateName: getComms("PRODUCT_TEMPLATE_NAME", "SANDBOX") ?? null,
    productTemplateLang: getComms("PRODUCT_TEMPLATE_LANG", "SANDBOX") ?? null
  };

  const aiOpenAi = {
    configured: !!openAiCreds.get("API_KEY"),
    apiKeyMasked: maskSecret(openAiCreds.get("API_KEY") || undefined)
  };

  const aiDeepseek = {
    configured: !!deepseekCreds.get("API_KEY"),
    apiKeyMasked: maskSecret(deepseekCreds.get("API_KEY") || undefined)
  };

  const checkoutConfig = readCheckoutConfig(checkoutConfigRaw);
  const envBases = getCheckoutBaseUrlsFromEnv();
  const storedPlanBaseUrl = String(checkoutConfig?.planBaseUrl || "").trim();
  const storedSubscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
  const storedCartBaseUrl = String(checkoutConfig?.cartBaseUrl || "").trim();
  let autoDebitConfigRaw: any = {};
  try {
    autoDebitConfigRaw = wompiCreds.get("AUTO_DEBIT_CONFIG") ? JSON.parse(String(wompiCreds.get("AUTO_DEBIT_CONFIG"))) : {};
  } catch (err: any) {
    logger.warn({ err }, "Fallo parseando AUTO_DEBIT_CONFIG en getAdminSettings");
    autoDebitConfigRaw = {};
  }
  const autoDebitConfig = {
    enabled: toBool(autoDebitConfigRaw?.enabled, true),
    chargeAtCutoffEnabled: toBool(autoDebitConfigRaw?.chargeAtCutoffEnabled, true),
    allowManualCharge: toBool(autoDebitConfigRaw?.allowManualCharge, true),
    executionHour: String(autoDebitConfigRaw?.executionHour || "09:00").trim() || "09:00",
    timeZone:
      String(
        autoDebitConfigRaw?.timeZone ||
          autoDebitConfigRaw?.timezone ||
          checkoutConfig?.timeZone ||
          checkoutConfig?.timezone ||
          "America/Bogota"
      ).trim() || "America/Bogota",
    retryEnabled: toBool(autoDebitConfigRaw?.retryEnabled, false),
    retryEveryMinutes: toInt(autoDebitConfigRaw?.retryEveryMinutes, 60, 1, 10080),
    retryEveryValue: deriveRetryUnitAndValue(toInt(autoDebitConfigRaw?.retryEveryMinutes, 60, 1, 10080)).retryEveryValue,
    retryEveryUnit: deriveRetryUnitAndValue(toInt(autoDebitConfigRaw?.retryEveryMinutes, 60, 1, 10080)).retryEveryUnit,
    maxRetries: toInt(autoDebitConfigRaw?.maxRetries, 0, 0, 20),
    graceDays: toInt(autoDebitConfigRaw?.graceDays, 5, 1, 30),
    suspendDays: toInt(autoDebitConfigRaw?.suspendDays, 15, 1, 180),
    cancelDays: toInt(autoDebitConfigRaw?.cancelDays, 30, 1, 365)
  };

  let paymentsConfigRaw: any = {};
  try {
    paymentsConfigRaw = wompiCreds.get("PAYMENTS_CONFIG") ? JSON.parse(String(wompiCreds.get("PAYMENTS_CONFIG"))) : {};
  } catch (err: any) {
    logger.warn({ err }, "Fallo parseando PAYMENTS_CONFIG en getAdminSettings");
    paymentsConfigRaw = {};
  }
  const paymentsConfig = {
    autoReconcileUnlinkedPayments: toBool(paymentsConfigRaw?.autoReconcileUnlinkedPayments, true),
    acceptUnlinkedPayments: toBool(paymentsConfigRaw?.acceptUnlinkedPayments, true),
    notifyWhatsappForUnlinkedPayments: toBool(paymentsConfigRaw?.notifyWhatsappForUnlinkedPayments, true),
    includeUnlinkedPaymentsInMetrics: toBool(paymentsConfigRaw?.includeUnlinkedPaymentsInMetrics, true)
  };

  return {
    encryptionKeyConfigured,
    encryptionKeyValid,
    wompi: {
      activeEnv: wompiActiveEnv,
      production: wompiProd,
      sandbox: wompiSandbox
    },
    shopify: {
      forwardUrl: shopifyForwardUrl ?? null,
      forwardOrigin: shopifyForwardOrigin,
      forwardRetryEnabled: shopifyForwardRetryEnabled,
      forwardRetryMinutes: shopifyForwardRetryMinutes
    },
    autoDebit: autoDebitConfig,
    paymentsConfig,
    communications: {
      activeEnv: chatwootActiveEnv,
      production: commsProd,
      sandbox: commsSandbox
    },
    ai: {
      enabled: aiAccess.enabled,
      reason: aiAccess.reason,
      providers: {
        openai: aiOpenAi,
        deepseek: aiDeepseek
      }
    },
    chatwoot: {
      baseUrl: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.baseUrl : commsProd.baseUrl) ?? null,
      accountId: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.accountId : commsProd.accountId) ?? null,
      inboxId: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.inboxId : commsProd.inboxId) ?? null
    },
    checkoutConfig: {
      planBaseUrl: storedPlanBaseUrl || envBases.planBaseUrl,
      subscriptionBaseUrl: storedSubscriptionBaseUrl || envBases.subscriptionBaseUrl,
      cartBaseUrl: storedCartBaseUrl || envBases.cartBaseUrl,
      timeZone: String(checkoutConfig?.timeZone || checkoutConfig?.timezone || "America/Bogota").trim() || "America/Bogota",
      defaultUtmParams: checkoutConfig.defaultUtmParams || "",
      defaultPlanTemplateId: String(checkoutConfig?.defaultPlanTemplateId || "").trim(),
      defaultSubscriptionTemplateId: String(checkoutConfig?.defaultSubscriptionTemplateId || "").trim(),
      defaultCartTemplateId: String(checkoutConfig?.defaultCartTemplateId || "").trim(),
      tokenExpiryHours:
        Number.isFinite(Number(checkoutConfig.tokenExpiryHours)) && Number(checkoutConfig.tokenExpiryHours) > 0
          ? Number(checkoutConfig.tokenExpiryHours)
          : 24
    }
  };
}
