import express from "express";
import { z } from "zod";
import { CredentialProvider, LogLevel } from "@prisma/client";
import { getCredential, getCredentialsBulk, setCredential } from "../services/credentials";
import { systemLog } from "../services/systemLog";
import { testShopifyForward } from "./shopifyForwardTest";

const envSchema = z.enum(["PRODUCTION", "SANDBOX"]);
type ActiveEnv = z.infer<typeof envSchema>;

function maskSecret(value: string | undefined) {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 4) return "****";
  return `${"*".repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}

async function getOrEnv(provider: CredentialProvider, key: string, envVal: string | undefined) {
  const fromDb = await getCredential(provider, key);
  return (fromDb ?? (envVal || "").trim()) || undefined;
}

async function getOrEnvEnv(provider: CredentialProvider, key: string, env: ActiveEnv, envVal: string | undefined) {
  const fromDb = await getCredential(provider, `${key}_${env}`);
  return (fromDb ?? (envVal || "").trim()) || undefined;
}

async function getActiveEnv(provider: CredentialProvider, envVarName: string): Promise<ActiveEnv> {
  const fromDb = await getCredential(provider, "ACTIVE_ENV");
  const normalized = String(fromDb || process.env[envVarName] || "PRODUCTION")
    .trim()
    .toUpperCase();
  return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
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

const shopifyUpdateSchema = z.object({
  forwardUrl: z.string().url().optional().or(z.literal("")),
  forwardSecret: z.string().optional().or(z.literal(""))
});

const chatwootUpdateSchema = z.object({
  environment: envSchema.optional(),
  activeEnv: envSchema.optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
  accountId: z.coerce.number().int().positive().optional(),
  apiAccessToken: z.string().optional().or(z.literal("")),
  inboxId: z.coerce.number().int().positive().optional()
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

  const [wompiCreds, shopifyCreds, commsCreds] = await Promise.all([
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
    getCredentialsBulk(CredentialProvider.SHOPIFY, ["FORWARD_URL"]),
    getCredentialsBulk(CredentialProvider.CHATWOOT, [
      "ACTIVE_ENV",
      "BASE_URL",
      "ACCOUNT_ID",
      "INBOX_ID",
      "API_ACCESS_TOKEN",
      "BASE_URL_PRODUCTION",
      "ACCOUNT_ID_PRODUCTION",
      "INBOX_ID_PRODUCTION",
      "API_ACCESS_TOKEN_PRODUCTION",
      "BASE_URL_SANDBOX",
      "ACCOUNT_ID_SANDBOX",
      "INBOX_ID_SANDBOX",
      "API_ACCESS_TOKEN_SANDBOX"
    ])
  ]);

  const wompiActiveEnv = (() => {
    const fromDb = wompiCreds.get("ACTIVE_ENV");
    const normalized = String(fromDb || process.env.WOMPI_ACTIVE_ENV || "PRODUCTION")
      .trim()
      .toUpperCase();
    return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  })() as ActiveEnv;

  const chatwootActiveEnv = (() => {
    const fromDb = commsCreds.get("ACTIVE_ENV");
    const normalized = String(fromDb || process.env.CHATWOOT_ACTIVE_ENV || "PRODUCTION")
      .trim()
      .toUpperCase();
    return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  })() as ActiveEnv;

  const getWompi = (key: string, env: ActiveEnv, envVal?: string) =>
    (wompiCreds.get(`${key}_${env}`) || wompiCreds.get(key) || (envVal || "").trim()) || undefined;
  const getComms = (key: string, env: ActiveEnv, envVal?: string) =>
    (commsCreds.get(`${key}_${env}`) || commsCreds.get(key) || (envVal || "").trim()) || undefined;

  const wompiProd = {
    publicKey: getWompi("PUBLIC_KEY", "PRODUCTION", process.env.WOMPI_PUBLIC_KEY) ?? null,
    privateKey: maskSecret(getWompi("PRIVATE_KEY", "PRODUCTION", process.env.WOMPI_PRIVATE_KEY)),
    integritySecret: maskSecret(getWompi("INTEGRITY_SECRET", "PRODUCTION", process.env.WOMPI_INTEGRITY_SECRET)),
    eventsSecret: maskSecret(getWompi("EVENTS_SECRET", "PRODUCTION", process.env.WOMPI_EVENTS_SECRET)),
    apiBaseUrl: getWompi("API_BASE_URL", "PRODUCTION", process.env.WOMPI_API_BASE_URL) ?? null,
    checkoutLinkBaseUrl: getWompi("CHECKOUT_LINK_BASE_URL", "PRODUCTION", process.env.WOMPI_CHECKOUT_LINK_BASE_URL) ?? null,
    redirectUrl: getWompi("REDIRECT_URL", "PRODUCTION", process.env.WOMPI_REDIRECT_URL) ?? null
  };

  const wompiSandbox = {
    publicKey: getWompi("PUBLIC_KEY", "SANDBOX", process.env.WOMPI_PUBLIC_KEY_SANDBOX) ?? null,
    privateKey: maskSecret(getWompi("PRIVATE_KEY", "SANDBOX", process.env.WOMPI_PRIVATE_KEY_SANDBOX)),
    integritySecret: maskSecret(getWompi("INTEGRITY_SECRET", "SANDBOX", process.env.WOMPI_INTEGRITY_SECRET_SANDBOX)),
    eventsSecret: maskSecret(getWompi("EVENTS_SECRET", "SANDBOX", process.env.WOMPI_EVENTS_SECRET_SANDBOX)),
    apiBaseUrl: getWompi("API_BASE_URL", "SANDBOX", process.env.WOMPI_API_BASE_URL_SANDBOX) ?? null,
    checkoutLinkBaseUrl: getWompi("CHECKOUT_LINK_BASE_URL", "SANDBOX", process.env.WOMPI_CHECKOUT_LINK_BASE_URL_SANDBOX) ?? null,
    redirectUrl: getWompi("REDIRECT_URL", "SANDBOX", process.env.WOMPI_REDIRECT_URL_SANDBOX) ?? null
  };

  const shopifyForwardUrl = (shopifyCreds.get("FORWARD_URL") || (process.env.SHOPIFY_FORWARD_URL || "").trim()) || undefined;

  const commsProd = {
    baseUrl: getComms("BASE_URL", "PRODUCTION", process.env.CHATWOOT_BASE_URL) ?? null,
    accountId:
      getComms("ACCOUNT_ID", "PRODUCTION", process.env.CHATWOOT_ACCOUNT_ID ? String(process.env.CHATWOOT_ACCOUNT_ID) : undefined) ?? null,
    inboxId: getComms("INBOX_ID", "PRODUCTION", process.env.CHATWOOT_INBOX_ID ? String(process.env.CHATWOOT_INBOX_ID) : undefined) ?? null
  };

  const commsSandbox = {
    baseUrl: getComms("BASE_URL", "SANDBOX", process.env.CHATWOOT_BASE_URL_SANDBOX) ?? null,
    accountId: getComms("ACCOUNT_ID", "SANDBOX", process.env.CHATWOOT_ACCOUNT_ID_SANDBOX) ?? null,
    inboxId: getComms("INBOX_ID", "SANDBOX", process.env.CHATWOOT_INBOX_ID_SANDBOX) ?? null
  };

  res.json({
    encryptionKeyConfigured,
    encryptionKeyValid,
    wompi: {
      activeEnv: wompiActiveEnv,
      production: wompiProd,
      sandbox: wompiSandbox
    },
    shopify: {
      forwardUrl: shopifyForwardUrl ?? null
    },
    communications: {
      activeEnv: chatwootActiveEnv,
      production: commsProd,
      sandbox: commsSandbox
    },
    // Back-compat: keep the old name pointing to the active environment.
    chatwoot: {
      baseUrl: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.baseUrl : commsProd.baseUrl) ?? null,
      accountId: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.accountId : commsProd.accountId) ?? null,
      inboxId: (chatwootActiveEnv === "SANDBOX" ? commsSandbox.inboxId : commsProd.inboxId) ?? null
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

settingsRouter.put("/shopify", async (req, res) => {
  const parsed = shopifyUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  try {
    if (parsed.data.forwardUrl != null) await setCredential(CredentialProvider.SHOPIFY, "FORWARD_URL", parsed.data.forwardUrl);
    if (parsed.data.forwardSecret != null)
      await setCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET", parsed.data.forwardSecret);
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.reenvio", "Configuración de reenvío actualizada").catch(() => {});
  res.json({ ok: true });
});

settingsRouter.post("/shopify/test-forward", testShopifyForward);

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
  } catch (err: any) {
    return res.status(400).json({ error: "credentials_error", message: String(err?.message || err) });
  }

  await systemLog(LogLevel.INFO, "configuracion.comunicaciones", "Credenciales de la central de comunicaciones actualizadas").catch(() => {});
  res.json({ ok: true });
});
