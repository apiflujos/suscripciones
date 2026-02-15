import { CredentialProvider } from "@prisma/client";
import { loadEnv } from "../config/env";
import { getCredential } from "./credentials";

type ActiveEnv = "PRODUCTION" | "SANDBOX";

function normalizeActiveEnv(value: string | undefined): ActiveEnv {
  const v = String(value || "")
    .trim()
    .toUpperCase();
  return v === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}

async function getActiveEnv(provider: CredentialProvider, envVarName: string): Promise<ActiveEnv> {
  const fromDb = await getCredential(provider, "ACTIVE_ENV");
  if (fromDb) return normalizeActiveEnv(fromDb);
  return normalizeActiveEnv(process.env[envVarName]);
}

function keyForEnv(key: string, env: ActiveEnv) {
  return `${key}_${env}`;
}

async function getCredentialForEnv(provider: CredentialProvider, key: string, env: ActiveEnv): Promise<string | undefined> {
  const envKey = await getCredential(provider, keyForEnv(key, env));
  if (envKey) return envKey;
  return await getCredential(provider, key);
}

export async function getWompiEventsSecret(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI, "WOMPI_ACTIVE_ENV");
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "EVENTS_SECRET", activeEnv);
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  if (activeEnv === "SANDBOX") return (process.env.WOMPI_EVENTS_SECRET_SANDBOX || "").trim() || undefined;
  return (env.WOMPI_EVENTS_SECRET || "").trim() || undefined;
}

export async function getWompiPublicKey(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI, "WOMPI_ACTIVE_ENV");
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "PUBLIC_KEY", activeEnv);
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  if (activeEnv === "SANDBOX") return (process.env.WOMPI_PUBLIC_KEY_SANDBOX || "").trim() || undefined;
  return (env.WOMPI_PUBLIC_KEY || "").trim() || undefined;
}

export async function getWompiPrivateKey(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI, "WOMPI_ACTIVE_ENV");
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "PRIVATE_KEY", activeEnv);
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  if (activeEnv === "SANDBOX") return (process.env.WOMPI_PRIVATE_KEY_SANDBOX || "").trim() || undefined;
  return (env.WOMPI_PRIVATE_KEY || "").trim() || undefined;
}

export async function getWompiIntegritySecret(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI, "WOMPI_ACTIVE_ENV");
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "INTEGRITY_SECRET", activeEnv);
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  if (activeEnv === "SANDBOX") return (process.env.WOMPI_INTEGRITY_SECRET_SANDBOX || "").trim() || undefined;
  return (env.WOMPI_INTEGRITY_SECRET || "").trim() || undefined;
}

export async function getWompiApiBaseUrl(): Promise<string> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI, "WOMPI_ACTIVE_ENV");
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "API_BASE_URL", activeEnv);
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  if (activeEnv === "SANDBOX") return (process.env.WOMPI_API_BASE_URL_SANDBOX || "").trim() || "https://sandbox.wompi.co/v1";
  return env.WOMPI_API_BASE_URL;
}

export async function getWompiCheckoutLinkBaseUrl(): Promise<string> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI, "WOMPI_ACTIVE_ENV");
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "CHECKOUT_LINK_BASE_URL", activeEnv);
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  if (activeEnv === "SANDBOX") return (process.env.WOMPI_CHECKOUT_LINK_BASE_URL_SANDBOX || "").trim() || env.WOMPI_CHECKOUT_LINK_BASE_URL;
  return env.WOMPI_CHECKOUT_LINK_BASE_URL;
}

export async function getWompiRedirectUrl(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI, "WOMPI_ACTIVE_ENV");
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "REDIRECT_URL", activeEnv);
  if (fromDb) return fromDb;
  const env = loadEnv(process.env);
  if (activeEnv === "SANDBOX") return (process.env.WOMPI_REDIRECT_URL_SANDBOX || "").trim() || undefined;
  return (env.WOMPI_REDIRECT_URL || "").trim() || undefined;
}

export async function getShopifyForward(): Promise<{ url?: string; secret?: string }> {
  const url = (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_URL")) || loadEnv(process.env).SHOPIFY_FORWARD_URL || "";
  const secret =
    (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET")) || loadEnv(process.env).SHOPIFY_FORWARD_SECRET || "";
  return { url: url.trim() || undefined, secret: secret.trim() || undefined };
}

export async function getShopifyForwardRetryConfig(): Promise<{ enabled: boolean; minutes: number }> {
  const enabledRaw =
    (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_ENABLED")) ||
    (process.env.SHOPIFY_FORWARD_RETRY_ENABLED || "").trim();
  const minutesRaw =
    (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES")) ||
    (process.env.SHOPIFY_FORWARD_RETRY_MINUTES || "").trim();

  const enabled = enabledRaw ? String(enabledRaw).toLowerCase() !== "false" : true;
  const minutesNum = Number(minutesRaw);
  const minutes = Number.isFinite(minutesNum) && minutesNum > 0 ? Math.min(Math.max(Math.trunc(minutesNum), 5), 1440) : 15;
  return { enabled, minutes };
}

export async function getPublicCheckoutConfig(): Promise<{
  baseUrl?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  contactEmail?: string;
  tokenExpiryHours: number;
}> {
  const raw = (await getCredential(CredentialProvider.WOMPI, "PUBLIC_CHECKOUT_CONFIG")) || "";
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}
  const baseUrl = String(parsed?.baseUrl || process.env.PUBLIC_CHECKOUT_BASE_URL || "").trim() || undefined;
  const title = String(parsed?.title || process.env.PUBLIC_CHECKOUT_TITLE || "").trim() || undefined;
  const subtitle = String(parsed?.subtitle || process.env.PUBLIC_CHECKOUT_SUBTITLE || "").trim() || undefined;
  const description = String(parsed?.description || process.env.PUBLIC_CHECKOUT_DESCRIPTION || "").trim() || undefined;
  const contactEmail = String(parsed?.contactEmail || process.env.PUBLIC_CHECKOUT_CONTACT_EMAIL || "").trim() || undefined;
  const hoursNum = Number(parsed?.tokenExpiryHours || process.env.PUBLIC_CHECKOUT_TOKEN_EXPIRY_HOURS || 24);
  const tokenExpiryHours = Number.isFinite(hoursNum) && hoursNum > 0 ? Math.min(Math.max(Math.trunc(hoursNum), 1), 168) : 24;
  return { baseUrl, title, subtitle, description, contactEmail, tokenExpiryHours };
}

export async function getChatwootConfig(): Promise<
  | { configured: false }
  | { configured: true; baseUrl: string; accountId: number; apiAccessToken: string; inboxId: number }
> {
  const activeEnv = await getActiveEnv(CredentialProvider.CHATWOOT, "CHATWOOT_ACTIVE_ENV");
  const env = loadEnv(process.env);
  const baseUrl = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "BASE_URL", activeEnv)) || env.CHATWOOT_BASE_URL || "";
  const accessToken =
    (await getCredentialForEnv(CredentialProvider.CHATWOOT, "API_ACCESS_TOKEN", activeEnv)) || env.CHATWOOT_API_ACCESS_TOKEN || "";
  const accountIdStr =
    (await getCredentialForEnv(CredentialProvider.CHATWOOT, "ACCOUNT_ID", activeEnv)) ||
    (env.CHATWOOT_ACCOUNT_ID ? String(env.CHATWOOT_ACCOUNT_ID) : "");
  const inboxIdStr =
    (await getCredentialForEnv(CredentialProvider.CHATWOOT, "INBOX_ID", activeEnv)) ||
    (env.CHATWOOT_INBOX_ID ? String(env.CHATWOOT_INBOX_ID) : "");

  const accountId = Number(accountIdStr);
  const inboxId = Number(inboxIdStr);

  if (!baseUrl.trim() || !accessToken.trim() || !Number.isFinite(accountId) || !Number.isFinite(inboxId)) return { configured: false };
  return { configured: true, baseUrl: baseUrl.trim(), apiAccessToken: accessToken.trim(), accountId, inboxId };
}
