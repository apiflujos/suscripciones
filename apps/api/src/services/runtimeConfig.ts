import { CredentialProvider } from "@prisma/client";
import { getCredential } from "./credentials";

type ActiveEnv = "PRODUCTION" | "SANDBOX";

function normalizeActiveEnv(value: string | undefined): ActiveEnv {
  const v = String(value || "")
    .trim()
    .toUpperCase();
  return v === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}

async function getActiveEnv(provider: CredentialProvider): Promise<ActiveEnv> {
  const fromDb = await getCredential(provider, "ACTIVE_ENV");
  if (fromDb) return normalizeActiveEnv(fromDb);
  return normalizeActiveEnv(undefined);
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
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "EVENTS_SECRET", activeEnv);
  if (fromDb) return fromDb;
  return undefined;
}

export async function getWompiPublicKey(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "PUBLIC_KEY", activeEnv);
  if (fromDb) return fromDb;
  return undefined;
}

export async function getWompiPrivateKey(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "PRIVATE_KEY", activeEnv);
  if (fromDb) return fromDb;
  return undefined;
}

export async function getWompiIntegritySecret(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "INTEGRITY_SECRET", activeEnv);
  if (fromDb) return fromDb;
  return undefined;
}

export async function getWompiApiBaseUrl(): Promise<string> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "API_BASE_URL", activeEnv);
  if (fromDb) return fromDb;
  if (activeEnv === "SANDBOX") return "https://sandbox.wompi.co/v1";
  return "https://api.wompi.co/v1";
}

export async function getWompiCheckoutLinkBaseUrl(): Promise<string> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "CHECKOUT_LINK_BASE_URL", activeEnv);
  if (fromDb) return fromDb;
  return "https://checkout.wompi.co/l/";
}

export async function getWompiRedirectUrl(): Promise<string | undefined> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const fromDb = await getCredentialForEnv(CredentialProvider.WOMPI, "REDIRECT_URL", activeEnv);
  if (fromDb) return fromDb;
  return undefined;
}

export async function getShopifyForward(): Promise<{ url?: string; secret?: string; origin?: string }> {
  const url = (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_URL")) || "";
  const secret = (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET")) || "";
  const origin = (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_ORIGIN")) || "shopify";
  return { url: url.trim() || undefined, secret: secret.trim() || undefined, origin: String(origin || "").trim() || "shopify" };
}

export async function getShopifyForwardRetryConfig(): Promise<{ enabled: boolean; minutes: number }> {
  const enabledRaw = (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_ENABLED")) || "";
  const minutesRaw = (await getCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES")) || "";

  const enabled = enabledRaw ? String(enabledRaw).toLowerCase() !== "false" : true;
  const minutesNum = Number(minutesRaw);
  const minutes = Number.isFinite(minutesNum) && minutesNum > 0 ? Math.min(Math.max(Math.trunc(minutesNum), 5), 1440) : 15;
  return { enabled, minutes };
}

export type AutoDebitConfig = {
  enabled: boolean;
  retryEnabled: boolean;
  retryEveryMinutes: number;
  maxRetries: number;
};

function toBool(raw: string | undefined, fallback: boolean) {
  if (!raw) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (!v) return fallback;
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}

function toInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function getAutoDebitConfig(): Promise<AutoDebitConfig> {
  const raw = (await getCredential(CredentialProvider.WOMPI, "AUTO_DEBIT_CONFIG")) || "";
  let parsed: any = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  const envDisabled = toBool(process.env.AUTO_DEBIT_DISABLED, false);
  const envRetryEnabled = toBool(process.env.AUTO_DEBIT_RETRY_ENABLED, false);
  const envRetryMinutes = toInt(process.env.AUTO_DEBIT_RETRY_MINUTES, 60, 1, 10_080);
  const envMaxRetries = toInt(process.env.AUTO_DEBIT_MAX_RETRIES, 0, 0, 20);

  const enabled = envDisabled ? false : toBool(String(parsed?.enabled ?? ""), true);
  const retryEnabled = toBool(String(parsed?.retryEnabled ?? ""), envRetryEnabled);
  const retryEveryMinutes = toInt(String(parsed?.retryEveryMinutes ?? ""), envRetryMinutes, 1, 10_080);
  const maxRetries = toInt(String(parsed?.maxRetries ?? ""), envMaxRetries, 0, 20);

  return { enabled, retryEnabled: enabled ? retryEnabled : false, retryEveryMinutes, maxRetries };
}

export async function getChatwootConfig(): Promise<
  | { configured: false }
  | { configured: true; baseUrl: string; accountId: number; apiAccessToken: string; inboxId: number }
> {
  const activeEnv = await getActiveEnv(CredentialProvider.CHATWOOT);
  const baseUrl = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "BASE_URL", activeEnv)) || "";
  const accessToken = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "API_ACCESS_TOKEN", activeEnv)) || "";
  const accountIdStr = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "ACCOUNT_ID", activeEnv)) || "";
  const inboxIdStr = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "INBOX_ID", activeEnv)) || "";

  const accountId = Number(accountIdStr);
  const inboxId = Number(inboxIdStr);

  if (!baseUrl.trim() || !accessToken.trim() || !Number.isFinite(accountId) || !Number.isFinite(inboxId)) return { configured: false };
  return { configured: true, baseUrl: baseUrl.trim(), apiAccessToken: accessToken.trim(), accountId, inboxId };
}
