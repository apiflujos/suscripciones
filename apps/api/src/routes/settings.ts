import express from "express";
import { z } from "zod";
import { CredentialProvider, LogLevel } from "@prisma/client";
import { clearCredential, getCredential, getCredentialsBulk, setCredential } from "../services/credentials";
import { systemLog } from "../services/systemLog";
import { testShopifyForward } from "./shopifyForwardTest";
import { WompiClient } from "../providers/wompi/client";
import { getCheckoutBaseUrlsFromEnv } from "../services/publicBase";

const envSchema = z.enum(["PRODUCTION", "SANDBOX"]);
type ActiveEnv = z.infer<typeof envSchema>;

function maskSecret(value: string | undefined) {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 4) return "****";
  return `${"*".repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}

const wompiUpdateSchema = z.object({
  environment: envSchema.optional(),
  activeEnv: envSchema.optional(),
  publicKey: z.string().min(1).optional(),
  privateKey: z.string().min(1).optional(),
  integritySecret: z.string().min(1).optional(),
  eventsSecret: z.string().min(1).optional(),
  apiBaseUrl: z.string().url().optional(),
  checkoutLinkBaseUrl: z.string().url().optional(),
  redirectUrl: z.string().url().optional().or(z.literal(""))
});

const wompiTestSchema = z.object({
  environment: envSchema.optional(),
  publicKey: z.string().optional().or(z.literal("")),
  apiBaseUrl: z.string().url().optional().or(z.literal(""))
});

const envOnlySchema = z.object({
  environment: envSchema.optional()
});

const shopifyUpdateSchema = z.object({
  forwardUrl: z.string().url().optional().or(z.literal("")),
  forwardSecret: z.string().optional().or(z.literal("")),
  forwardOrigin: z.enum(["shopify", "shopify-native"]).optional(),
  forwardRetryEnabled: z.union([z.boolean(), z.string()]).optional(),
  forwardRetryMinutes: z.coerce.number().int().positive().optional()
});

const chatwootUpdateSchema = z.object({
  environment: envSchema.optional(),
  activeEnv: envSchema.optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
  accountId: z.coerce.number().int().positive().optional(),
  apiAccessToken: z.string().optional().or(z.literal("")),
  inboxId: z.coerce.number().int().positive().optional(),
  productTemplateName: z.string().optional().or(z.literal("")),
  productTemplateLang: z.string().optional().or(z.literal(""))
});

const aiProviderSchema = z.enum(["OPENAI", "DEEPSEEK"]);
const aiActiveProviderSchema = z.enum(["OPENAI", "DEEPSEEK", "NONE"]);
const aiUpdateSchema = z.object({
  provider: aiProviderSchema,
  activeProvider: aiActiveProviderSchema.optional(),
  apiKey: z.string().optional().or(z.literal("")),
  baseUrl: z.string().url().optional().or(z.literal("")),
  model: z.string().optional().or(z.literal("")),
  maxTokens: z.coerce.number().int().positive().optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  timeoutMs: z.coerce.number().int().positive().optional()
});

const aiDeleteSchema = z.object({
  provider: aiProviderSchema
});

const checkoutConfigUpdateSchema = z.object({
  planBaseUrl: z.string().url().optional().or(z.literal("")),
  subscriptionBaseUrl: z.string().url().optional().or(z.literal("")),
  defaultUtmParams: z.string().optional().or(z.literal("")),
  tokenExpiryHours: z.coerce.number().int().positive().optional(),
  logoUrl: z.string().optional().or(z.literal("")),
  supportEmail: z.string().optional().or(z.literal("")),
  supportUrl: z.string().optional().or(z.literal("")),
  planTitle: z.string().optional().or(z.literal("")),
  planDescription: z.string().optional().or(z.literal("")),
  subscriptionTitle: z.string().optional().or(z.literal("")),
  subscriptionDescription: z.string().optional().or(z.literal("")),
  planWompiTitle: z.string().optional().or(z.literal("")),
  planWompiDescription: z.string().optional().or(z.literal("")),
  subscriptionWompiTitle: z.string().optional().or(z.literal("")),
  subscriptionWompiDescription: z.string().optional().or(z.literal("")),
  tokenizationSuccessTitle: z.string().optional().or(z.literal("")),
  tokenizationSuccessMessage: z.string().optional().or(z.literal("")),
  tokenizationErrorMessage: z.string().optional().or(z.literal("")),
  tokenizationReturnUrl: z.string().url().optional().or(z.literal(""))
});

 

export const settingsRouter = express.Router();

settingsRouter.get("/", async (_req, res) => {
  const encKeyB64 = (process.env.CREDENTIALS_ENCRYPTION_KEY_B64 || "").trim();
  const encryptionKeyConfigured = !!encKeyB64;
  let encryptionKeyValid = false;
  if (encryptionKeyConfigured) {
    const buf = Buffer.from(encKeyB64, "base64");
    encryptionKeyValid = buf.length === 32;
  }

  const [wompiCreds, shopifyCreds, commsCreds, checkoutConfigRaw, openAiCreds, deepseekCreds] = await Promise.all([
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
      "REDIRECT_URL_SANDBOX"
    ]),
    getCredentialsBulk(CredentialProvider.SHOPIFY, ["FORWARD_URL", "FORWARD_SECRET", "FORWARD_ORIGIN", "FORWARD_RETRY_ENABLED", "FORWARD_RETRY_MINUTES"]),
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
    getCredentialsBulk(CredentialProvider.OPENAI, [
      "API_KEY",
      "BASE_URL",
      "MODEL",
      "MAX_TOKENS",
      "TEMPERATURE",
      "TIMEOUT_MS",
      "ACTIVE_PROVIDER"
    ]),
    getCredentialsBulk(CredentialProvider.DEEPSEEK, [
      "API_KEY",
      "BASE_URL",
      "MODEL",
      "MAX_TOKENS",
      "TEMPERATURE",
      "TIMEOUT_MS"
    ])
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

  const toInt = (value: string | undefined) => {
    if (value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : null;
  };

  const toFloat = (value: string | undefined) => {
    if (value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const aiActiveProvider = (() => {
    const raw = String(openAiCreds.get("ACTIVE_PROVIDER") || "")
      .trim()
      .toUpperCase();
    if (raw === "OPENAI" || raw === "DEEPSEEK") return raw;
    return "NONE";
  })() as "OPENAI" | "DEEPSEEK" | "NONE";

  const aiOpenAi = {
    configured: !!openAiCreds.get("API_KEY"),
    apiKeyMasked: maskSecret(openAiCreds.get("API_KEY") || undefined),
    baseUrl: openAiCreds.get("BASE_URL") ?? null,
    model: openAiCreds.get("MODEL") ?? null,
    maxTokens: toInt(openAiCreds.get("MAX_TOKENS") || undefined),
    temperature: toFloat(openAiCreds.get("TEMPERATURE") || undefined),
    timeoutMs: toInt(openAiCreds.get("TIMEOUT_MS") || undefined)
  };

  const aiDeepseek = {
    configured: !!deepseekCreds.get("API_KEY"),
    apiKeyMasked: maskSecret(deepseekCreds.get("API_KEY") || undefined),
    baseUrl: deepseekCreds.get("BASE_URL") ?? null,
    model: deepseekCreds.get("MODEL") ?? null,
    maxTokens: toInt(deepseekCreds.get("MAX_TOKENS") || undefined),
    temperature: toFloat(deepseekCreds.get("TEMPERATURE") || undefined),
    timeoutMs: toInt(deepseekCreds.get("TIMEOUT_MS") || undefined)
  };

  let checkoutConfig: any = {};
  try {
    checkoutConfig = checkoutConfigRaw ? JSON.parse(checkoutConfigRaw) : {};
  } catch {
    checkoutConfig = {};
  }
  const envBases = getCheckoutBaseUrlsFromEnv();
  const storedPlanBaseUrl = String(checkoutConfig?.planBaseUrl || "").trim();
  const storedSubscriptionBaseUrl = String(checkoutConfig?.subscriptionBaseUrl || "").trim();

  res.json({
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
    communications: {
      activeEnv: chatwootActiveEnv,
      production: commsProd,
      sandbox: commsSandbox
    },
    ai: {
      activeProvider: aiActiveProvider,
      providers: {
        openai: aiOpenAi,
        deepseek: aiDeepseek
      }
    },
    // Back-compat: keep the old name pointing to the active environment.
    chatwoot: {
      baseUrl: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.baseUrl : commsProd.baseUrl) ?? null,
      accountId: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.accountId : commsProd.accountId) ?? null,
      inboxId: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.inboxId : commsProd.inboxId) ?? null
    },
    checkoutConfig: {
      planBaseUrl: storedPlanBaseUrl || envBases.planBaseUrl,
      subscriptionBaseUrl: storedSubscriptionBaseUrl || envBases.subscriptionBaseUrl,
      defaultUtmParams: checkoutConfig.defaultUtmParams || "",
      tokenExpiryHours:
        Number.isFinite(Number(checkoutConfig.tokenExpiryHours)) && Number(checkoutConfig.tokenExpiryHours) > 0
          ? Math.trunc(Number(checkoutConfig.tokenExpiryHours))
        : 24,
      logoUrl: checkoutConfig.logoUrl || null,
      supportEmail: checkoutConfig.supportEmail || null,
      supportUrl: checkoutConfig.supportUrl || null,
      planTitle: checkoutConfig.planTitle || "Paga tu plan",
      planDescription: checkoutConfig.planDescription || "",
      subscriptionTitle: checkoutConfig.subscriptionTitle || "Activa tu suscripción",
      subscriptionDescription: checkoutConfig.subscriptionDescription || "",
      planWompiTitle: checkoutConfig.planWompiTitle || "",
      planWompiDescription: checkoutConfig.planWompiDescription || "",
      subscriptionWompiTitle: checkoutConfig.subscriptionWompiTitle || "",
      subscriptionWompiDescription: checkoutConfig.subscriptionWompiDescription || "",
      tokenizationSuccessTitle: checkoutConfig.tokenizationSuccessTitle || "",
      tokenizationSuccessMessage: checkoutConfig.tokenizationSuccessMessage || "",
      tokenizationErrorMessage: checkoutConfig.tokenizationErrorMessage || "",
      tokenizationReturnUrl: checkoutConfig.tokenizationReturnUrl || ""
    }
  });
});

settingsRouter.put("/wompi", async (req, res) => {
  const parsed = wompiUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
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
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.wompi", "Credenciales de Wompi actualizadas").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.post("/wompi/test", async (req, res) => {
  const parsed = wompiTestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
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

  if (!publicKey) return res.status(400).json({ error: "wompi_public_key_not_configured" });

  try {
    const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl: "https://checkout.wompi.co/l/" });
    await wompi.getMerchant(publicKey);
  } catch (err: any) {
    return res.status(400).json({ error: "wompi_test_failed", message: String(err?.message || err) });
  }

  res.json({ ok: true });
});

settingsRouter.delete("/wompi", async (req, res) => {
  const parsed = envOnlySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
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
    await Promise.all(
      keys.map((key) =>
        clearCredential(CredentialProvider.WOMPI, key).catch(() => {})
      )
    );
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.wompi", "Credenciales de Wompi eliminadas", { env }).catch(() => {});
  res.json({ ok: true });
});

settingsRouter.put("/shopify", async (req, res) => {
  const parsed = shopifyUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    if (parsed.data.forwardUrl != null) await setCredential(CredentialProvider.SHOPIFY, "FORWARD_URL", parsed.data.forwardUrl);
    if (parsed.data.forwardSecret != null)
      await setCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET", parsed.data.forwardSecret);
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
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.reenvio", "Configuración de reenvío actualizada").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.delete("/shopify", async (_req, res) => {
  try {
    await Promise.all([
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_URL").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_ORIGIN").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_ENABLED").catch(() => {}),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES").catch(() => {})
    ]);
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.reenvio", "Configuración de reenvío eliminada").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.post("/shopify/test-forward", testShopifyForward);

settingsRouter.put("/checkout-config", async (req, res) => {
  const parsed = checkoutConfigUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

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
  res.json({ ok: true });
});

settingsRouter.put("/chatwoot", async (req, res) => {
  const parsed = chatwootUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

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
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.comunicaciones", "Credenciales de la central de comunicaciones actualizadas").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.delete("/chatwoot", async (req, res) => {
  const parsed = chatwootUpdateSchema.pick({ environment: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
    await setCredential(CredentialProvider.CHATWOOT, `BASE_URL_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `ACCOUNT_ID_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `INBOX_ID_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `API_ACCESS_TOKEN_${env}`, "");
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.comunicaciones", "Credenciales de la central de comunicaciones eliminadas").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.put("/ai", async (req, res) => {
  const parsed = aiUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const provider = parsed.data.provider;
  const credentialProvider = provider === "DEEPSEEK" ? CredentialProvider.DEEPSEEK : CredentialProvider.OPENAI;

  try {
    if (parsed.data.activeProvider) {
      await setCredential(CredentialProvider.OPENAI, "ACTIVE_PROVIDER", parsed.data.activeProvider);
    }
    if (parsed.data.apiKey != null) await setCredential(credentialProvider, "API_KEY", parsed.data.apiKey);
    if (parsed.data.baseUrl != null) await setCredential(credentialProvider, "BASE_URL", parsed.data.baseUrl);
    if (parsed.data.model != null) await setCredential(credentialProvider, "MODEL", parsed.data.model);
    if (parsed.data.maxTokens != null) await setCredential(credentialProvider, "MAX_TOKENS", String(parsed.data.maxTokens));
    if (parsed.data.temperature != null) await setCredential(credentialProvider, "TEMPERATURE", String(parsed.data.temperature));
    if (parsed.data.timeoutMs != null) await setCredential(credentialProvider, "TIMEOUT_MS", String(parsed.data.timeoutMs));
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.ia", "Configuración de IA actualizada", { provider }).catch(() => {});
  res.json({ ok: true });
});

settingsRouter.delete("/ai", async (req, res) => {
  const parsed = aiDeleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const provider = parsed.data.provider;
  const credentialProvider = provider === "DEEPSEEK" ? CredentialProvider.DEEPSEEK : CredentialProvider.OPENAI;

  try {
    await Promise.all([
      clearCredential(credentialProvider, "API_KEY"),
      clearCredential(credentialProvider, "BASE_URL"),
      clearCredential(credentialProvider, "MODEL"),
      clearCredential(credentialProvider, "MAX_TOKENS"),
      clearCredential(credentialProvider, "TEMPERATURE"),
      clearCredential(credentialProvider, "TIMEOUT_MS")
    ]);

    const activeProviderRaw = String((await getCredential(CredentialProvider.OPENAI, "ACTIVE_PROVIDER")) || "")
      .trim()
      .toUpperCase();
    if (activeProviderRaw === provider) {
      await setCredential(CredentialProvider.OPENAI, "ACTIVE_PROVIDER", "NONE");
    }
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.ia", "Configuración de IA eliminada", { provider }).catch(() => {});
  res.json({ ok: true });
});
