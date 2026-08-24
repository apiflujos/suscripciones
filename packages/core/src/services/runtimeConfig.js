"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWompiEventsSecret = getWompiEventsSecret;
exports.getWompiEventsSecrets = getWompiEventsSecrets;
exports.getWompiPublicKey = getWompiPublicKey;
exports.getWompiPrivateKey = getWompiPrivateKey;
exports.getWompiIntegritySecret = getWompiIntegritySecret;
exports.getWompiApiBaseUrl = getWompiApiBaseUrl;
exports.getWompiCheckoutLinkBaseUrl = getWompiCheckoutLinkBaseUrl;
exports.getWompiRedirectUrl = getWompiRedirectUrl;
exports.getShopifyForward = getShopifyForward;
exports.getShopifyForwardRetryConfig = getShopifyForwardRetryConfig;
exports.getAutoDebitConfig = getAutoDebitConfig;
exports.getPaymentsConfig = getPaymentsConfig;
exports.getAppTimeZone = getAppTimeZone;
exports.getChatwootConfig = getChatwootConfig;
const client_1 = require("@prisma/client");
const credentials_1 = require("./credentials");
const publicBase_1 = require("./publicBase");
const timeZoneScheduling_1 = require("../lib/timeZoneScheduling");
function normalizeActiveEnv(value) {
    const v = String(value || "")
        .trim()
        .toUpperCase();
    return v === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}
async function getActiveEnv(provider) {
    const fromDb = await (0, credentials_1.getCredential)(provider, "ACTIVE_ENV");
    if (fromDb)
        return normalizeActiveEnv(fromDb);
    return normalizeActiveEnv(undefined);
}
function keyForEnv(key, env) {
    return `${key}_${env}`;
}
async function getCredentialForEnv(provider, key, env) {
    const envKey = await (0, credentials_1.getCredential)(provider, keyForEnv(key, env));
    if (envKey)
        return envKey;
    return await (0, credentials_1.getCredential)(provider, key);
}
async function getWompiEventsSecret() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const fromDb = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "EVENTS_SECRET", activeEnv);
    if (fromDb)
        return fromDb;
    return undefined;
}
async function getWompiEventsSecrets() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const active = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "EVENTS_SECRET", activeEnv);
    const production = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "EVENTS_SECRET", "PRODUCTION");
    const sandbox = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "EVENTS_SECRET", "SANDBOX");
    return { active, production, sandbox };
}
async function getWompiPublicKey() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const fromDb = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "PUBLIC_KEY", activeEnv);
    if (fromDb)
        return fromDb;
    return undefined;
}
async function getWompiPrivateKey() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const fromDb = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "PRIVATE_KEY", activeEnv);
    if (fromDb)
        return fromDb;
    return undefined;
}
async function getWompiIntegritySecret() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const fromDb = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "INTEGRITY_SECRET", activeEnv);
    if (fromDb)
        return fromDb;
    return undefined;
}
async function getWompiApiBaseUrl() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const fromDb = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "API_BASE_URL", activeEnv);
    if (fromDb)
        return fromDb;
    if (activeEnv === "SANDBOX")
        return "https://sandbox.wompi.co/v1";
    return "https://api.wompi.co/v1";
}
async function getWompiCheckoutLinkBaseUrl() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const fromDb = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "CHECKOUT_LINK_BASE_URL", activeEnv);
    if (fromDb)
        return fromDb;
    return "https://checkout.wompi.co/l/";
}
async function getWompiRedirectUrl() {
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.WOMPI);
    const fromDb = await getCredentialForEnv(client_1.CredentialProvider.WOMPI, "REDIRECT_URL", activeEnv);
    if (fromDb)
        return fromDb;
    const checkoutConfigRaw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
    try {
        const parsed = checkoutConfigRaw ? JSON.parse(checkoutConfigRaw) : {};
        const configured = (0, publicBase_1.getSafePublicReturnUrl)(String(parsed?.tokenizationReturnUrl || "").trim());
        if (configured)
            return configured;
    }
    catch {
        // ignore malformed config and continue with env fallback
    }
    return (0, publicBase_1.getPublicReturnUrlFromEnv)() || undefined;
}
async function getShopifyForward() {
    const url = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.SHOPIFY, "FORWARD_URL")) || "";
    const secret = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.SHOPIFY, "FORWARD_SECRET")) || "";
    const origin = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.SHOPIFY, "FORWARD_ORIGIN")) || "shopify";
    return { url: url.trim() || undefined, secret: secret.trim() || undefined, origin: String(origin || "").trim() || "shopify" };
}
async function getShopifyForwardRetryConfig() {
    const enabledRaw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.SHOPIFY, "FORWARD_RETRY_ENABLED")) || "";
    const minutesRaw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES")) || "";
    const enabled = enabledRaw ? String(enabledRaw).toLowerCase() !== "false" : true;
    const minutesNum = Number(minutesRaw);
    const minutes = Number.isFinite(minutesNum) && minutesNum > 0 ? Math.min(Math.max(Math.trunc(minutesNum), 5), 1440) : 15;
    return { enabled, minutes };
}
function toBool(raw, fallback) {
    if (!raw)
        return fallback;
    const v = String(raw).trim().toLowerCase();
    if (!v)
        return fallback;
    return !(v === "0" || v === "false" || v === "no" || v === "off");
}
function toInt(raw, fallback, min, max) {
    const n = Number(raw);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(Math.max(Math.trunc(n), min), max);
}
function normalizeRetryUnit(raw) {
    const unit = String(raw || "")
        .trim()
        .toUpperCase();
    if (unit === "DAYS")
        return "DAYS";
    if (unit === "HOURS")
        return "HOURS";
    return "MINUTES";
}
function retryUnitMultiplier(unit) {
    if (unit === "DAYS")
        return 24 * 60;
    if (unit === "HOURS")
        return 60;
    return 1;
}
function deriveRetryUnitAndValue(minutes) {
    if (minutes % (24 * 60) === 0) {
        return { retryEveryValue: Math.max(1, Math.trunc(minutes / (24 * 60))), retryEveryUnit: "DAYS" };
    }
    if (minutes % 60 === 0) {
        return { retryEveryValue: Math.max(1, Math.trunc(minutes / 60)), retryEveryUnit: "HOURS" };
    }
    return { retryEveryValue: Math.max(1, Math.trunc(minutes)), retryEveryUnit: "MINUTES" };
}
function normalizeTimeZone(value, fallback) {
    const raw = String(value || "").trim();
    return raw || fallback;
}
async function getAutoDebitConfig() {
    const raw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "AUTO_DEBIT_CONFIG")) || "";
    let parsed = {};
    try {
        parsed = raw ? JSON.parse(raw) : {};
    }
    catch {
        parsed = {};
    }
    const envDisabled = toBool(process.env.AUTO_DEBIT_DISABLED, false);
    const envRetryEnabled = toBool(process.env.AUTO_DEBIT_RETRY_ENABLED, false);
    const envRetryMinutes = toInt(process.env.AUTO_DEBIT_RETRY_MINUTES, 60, 1, 10_080);
    const envMaxRetries = toInt(process.env.AUTO_DEBIT_MAX_RETRIES, 0, 0, 20);
    const fallbackTimeZone = await getAppTimeZone().catch(() => "America/Bogota");
    const executionHour = (0, timeZoneScheduling_1.normalizeClockTime)(parsed?.executionHour || process.env.AUTO_DEBIT_EXECUTION_HOUR || "09:00");
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
        graceDays
    };
}
async function getPaymentsConfig() {
    const raw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "PAYMENTS_CONFIG")) || "";
    let parsed = {};
    try {
        parsed = raw ? JSON.parse(raw) : {};
    }
    catch {
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
async function getAppTimeZone() {
    const envTz = String(process.env.APP_TIMEZONE || "").trim();
    if (envTz)
        return envTz;
    const raw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
    let parsed = {};
    try {
        parsed = raw ? JSON.parse(raw) : {};
    }
    catch {
        parsed = {};
    }
    const tz = String(parsed?.timeZone || parsed?.timezone || "").trim();
    return tz || "America/Bogota";
}
async function getChatwootConfig() {
    const readEnv = async (env) => {
        const baseUrl = (await getCredentialForEnv(client_1.CredentialProvider.CHATWOOT, "BASE_URL", env)) || "";
        const accessToken = (await getCredentialForEnv(client_1.CredentialProvider.CHATWOOT, "API_ACCESS_TOKEN", env)) || "";
        const accountIdStr = (await getCredentialForEnv(client_1.CredentialProvider.CHATWOOT, "ACCOUNT_ID", env)) || "";
        const inboxIdStr = (await getCredentialForEnv(client_1.CredentialProvider.CHATWOOT, "INBOX_ID", env)) || "";
        const accountId = Number(accountIdStr);
        const inboxId = Number(inboxIdStr);
        if (!baseUrl.trim() || !accessToken.trim() || !Number.isFinite(accountId) || !Number.isFinite(inboxId))
            return null;
        return { configured: true, baseUrl: baseUrl.trim(), apiAccessToken: accessToken.trim(), accountId, inboxId };
    };
    const activeEnv = await getActiveEnv(client_1.CredentialProvider.CHATWOOT);
    const activeCfg = await readEnv(activeEnv);
    if (activeCfg)
        return activeCfg;
    const prodCfg = await readEnv("PRODUCTION");
    if (prodCfg)
        return prodCfg;
    const sandboxCfg = await readEnv("SANDBOX");
    if (sandboxCfg)
        return sandboxCfg;
    return { configured: false };
}
