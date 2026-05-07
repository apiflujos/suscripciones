import { CredentialProvider } from "@prisma/client";
import { getCredential } from "./credentials";
import { getPublicReturnUrlFromEnv } from "./publicBase";
import { normalizeClockTime } from "../lib/timeZoneScheduling";

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

export async function getWompiEventsSecrets(): Promise<{ active?: string; production?: string; sandbox?: string }> {
  const activeEnv = await getActiveEnv(CredentialProvider.WOMPI);
  const active = await getCredentialForEnv(CredentialProvider.WOMPI, "EVENTS_SECRET", activeEnv);
  const production = await getCredentialForEnv(CredentialProvider.WOMPI, "EVENTS_SECRET", "PRODUCTION");
  const sandbox = await getCredentialForEnv(CredentialProvider.WOMPI, "EVENTS_SECRET", "SANDBOX");
  return { active, production, sandbox };
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
  const checkoutConfigRaw = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  try {
    const parsed = checkoutConfigRaw ? JSON.parse(checkoutConfigRaw) : {};
    const configured = String(parsed?.tokenizationReturnUrl || "").trim();
    if (configured) return configured;
  } catch {
    // ignore malformed config and continue with env fallback
  }
  return getPublicReturnUrlFromEnv() || undefined;
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
  chargeAtCutoffEnabled: boolean;
  allowManualCharge: boolean;
  executionHour: string;
  timeZone: string;
  retryEnabled: boolean;
  retryEveryValue: number;
  retryEveryUnit: "MINUTES" | "HOURS" | "DAYS";
  retryEveryMinutes: number;
  maxRetries: number;
  graceDays: number;
  suspendDays: number;
  cancelDays: number;
};

export type PaymentsConfig = {
  autoReconcileUnlinkedPayments: boolean;
  acceptUnlinkedPayments: boolean;
  notifyWhatsappForUnlinkedPayments: boolean;
  includeUnlinkedPaymentsInMetrics: boolean;
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

function normalizeRetryUnit(raw: unknown): "MINUTES" | "HOURS" | "DAYS" {
  const unit = String(raw || "")
    .trim()
    .toUpperCase();
  if (unit === "DAYS") return "DAYS";
  if (unit === "HOURS") return "HOURS";
  return "MINUTES";
}

function retryUnitMultiplier(unit: "MINUTES" | "HOURS" | "DAYS") {
  if (unit === "DAYS") return 24 * 60;
  if (unit === "HOURS") return 60;
  return 1;
}

function deriveRetryUnitAndValue(minutes: number): { retryEveryValue: number; retryEveryUnit: "MINUTES" | "HOURS" | "DAYS" } {
  if (minutes % (24 * 60) === 0) {
    return { retryEveryValue: Math.max(1, Math.trunc(minutes / (24 * 60))), retryEveryUnit: "DAYS" };
  }
  if (minutes % 60 === 0) {
    return { retryEveryValue: Math.max(1, Math.trunc(minutes / 60)), retryEveryUnit: "HOURS" };
  }
  return { retryEveryValue: Math.max(1, Math.trunc(minutes)), retryEveryUnit: "MINUTES" };
}

function normalizeTimeZone(value: unknown, fallback: string) {
  const raw = String(value || "").trim();
  return raw || fallback;
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
  const fallbackTimeZone = await getAppTimeZone().catch(() => "America/Bogota");
  const executionHour = normalizeClockTime(parsed?.executionHour || process.env.AUTO_DEBIT_EXECUTION_HOUR || "09:00");
  const timeZone = normalizeTimeZone(parsed?.timeZone || parsed?.timezone || process.env.AUTO_DEBIT_TIMEZONE, fallbackTimeZone);

  const enabled = envDisabled ? false : toBool(String(parsed?.enabled ?? ""), true);
  const chargeAtCutoffEnabled = toBool(String(parsed?.chargeAtCutoffEnabled ?? ""), true);
  const allowManualCharge = toBool(String(parsed?.allowManualCharge ?? ""), true);
  const retryEnabled = toBool(String(parsed?.retryEnabled ?? ""), envRetryEnabled);
  const retryUnit = normalizeRetryUnit(parsed?.retryEveryUnit);
  const retryValueRaw = toInt(String(parsed?.retryEveryValue ?? ""), 0, 0, 10_080);
  const retryEveryMinutesLegacy = toInt(String(parsed?.retryEveryMinutes ?? ""), envRetryMinutes, 1, 10_080);
  const retryEveryMinutes = retryValueRaw > 0
    ? toInt(String(retryValueRaw * retryUnitMultiplier(retryUnit)), envRetryMinutes, 1, 10_080)
    : retryEveryMinutesLegacy;
  const derived = deriveRetryUnitAndValue(retryEveryMinutes);
  const maxRetriesRaw = toInt(String(parsed?.maxRetries ?? ""), envMaxRetries, 0, 20);
  const maxRetries = retryEnabled ? Math.max(1, maxRetriesRaw) : maxRetriesRaw;
  const graceDays = toInt(String(parsed?.graceDays ?? ""), 5, 1, 30);
  const suspendDays = toInt(String(parsed?.suspendDays ?? ""), 15, 1, 180);
  const cancelDays = toInt(String(parsed?.cancelDays ?? ""), 30, 1, 365);

  return {
    enabled,
    chargeAtCutoffEnabled,
    allowManualCharge,
    executionHour,
    timeZone,
    retryEnabled,
    retryEveryValue: derived.retryEveryValue,
    retryEveryUnit: derived.retryEveryUnit,
    retryEveryMinutes,
    maxRetries,
    graceDays,
    suspendDays,
    cancelDays
  };
}

export async function getPaymentsConfig(): Promise<PaymentsConfig> {
  const raw = (await getCredential(CredentialProvider.WOMPI, "PAYMENTS_CONFIG")) || "";
  let parsed: any = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  // Defaults preserve current behavior.
  const autoReconcileUnlinkedPayments = toBool(String(parsed?.autoReconcileUnlinkedPayments ?? ""), true);
  const acceptUnlinkedPayments = toBool(String(parsed?.acceptUnlinkedPayments ?? ""), true);
  const notifyWhatsappForUnlinkedPayments = toBool(String(parsed?.notifyWhatsappForUnlinkedPayments ?? ""), true);
  const includeUnlinkedPaymentsInMetrics = toBool(String(parsed?.includeUnlinkedPaymentsInMetrics ?? ""), true);
  return {
    autoReconcileUnlinkedPayments,
    acceptUnlinkedPayments,
    notifyWhatsappForUnlinkedPayments,
    includeUnlinkedPaymentsInMetrics
  };
}

export async function getAppTimeZone(): Promise<string> {
  const envTz = String(process.env.APP_TIMEZONE || "").trim();
  if (envTz) return envTz;
  const raw = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  let parsed: any = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const tz = String(parsed?.timeZone || parsed?.timezone || "").trim();
  return tz || "America/Bogota";
}

export async function getChatwootConfig(): Promise<
  | { configured: false }
  | { configured: true; baseUrl: string; accountId: number; apiAccessToken: string; inboxId: number }
> {
  const readEnv = async (env: ActiveEnv) => {
    const baseUrl = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "BASE_URL", env)) || "";
    const accessToken = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "API_ACCESS_TOKEN", env)) || "";
    const accountIdStr = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "ACCOUNT_ID", env)) || "";
    const inboxIdStr = (await getCredentialForEnv(CredentialProvider.CHATWOOT, "INBOX_ID", env)) || "";

    const accountId = Number(accountIdStr);
    const inboxId = Number(inboxIdStr);

    if (!baseUrl.trim() || !accessToken.trim() || !Number.isFinite(accountId) || !Number.isFinite(inboxId)) return null;
    return { configured: true as const, baseUrl: baseUrl.trim(), apiAccessToken: accessToken.trim(), accountId, inboxId };
  };

  const activeEnv = await getActiveEnv(CredentialProvider.CHATWOOT);
  const activeCfg = await readEnv(activeEnv);
  if (activeCfg) return activeCfg;

  const prodCfg = await readEnv("PRODUCTION");
  if (prodCfg) return prodCfg;

  const sandboxCfg = await readEnv("SANDBOX");
  if (sandboxCfg) return sandboxCfg;

  return { configured: false };
}
