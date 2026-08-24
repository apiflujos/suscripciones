"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCheckoutBaseUrlsFromEnv = getCheckoutBaseUrlsFromEnv;
exports.getPublicReturnUrlFromEnv = getPublicReturnUrlFromEnv;
exports.normalizePublicUrl = normalizePublicUrl;
exports.getPublicBaseUrlFromEnv = getPublicBaseUrlFromEnv;
exports.getSafePublicReturnUrl = getSafePublicReturnUrl;
function ensureHttps(raw) {
    const value = String(raw || "").trim();
    if (!value)
        return "";
    if (/^https?:\/\//i.test(value))
        return value;
    return `https://${value.replace(/^\/+/, "")}`;
}
function getCheckoutBaseUrlsFromEnv() {
    const base = getPublicBaseUrlFromEnv();
    if (!base)
        return { planBaseUrl: null, subscriptionBaseUrl: null, cartBaseUrl: null };
    return {
        planBaseUrl: `${base}/public/plan`,
        subscriptionBaseUrl: `${base}/public/suscripcion`,
        cartBaseUrl: `${base}/public/cart`
    };
}
function getPublicReturnUrlFromEnv() {
    const base = getPublicBaseUrlFromEnv();
    if (!base)
        return null;
    return `${base}/public/return`;
}
function isUnsafeLocalHost(hostname) {
    const host = String(hostname || "").trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}
function normalizePublicUrl(raw, opts) {
    const value = String(raw || "").trim();
    if (!value)
        return "";
    if (opts?.allowRelative && value.startsWith("/"))
        return value;
    try {
        const parsed = new URL(ensureHttps(value));
        if (!opts?.allowLocalhost && isUnsafeLocalHost(parsed.hostname))
            return "";
        return parsed.toString();
    }
    catch {
        return "";
    }
}
function getPublicBaseUrlFromEnv() {
    const raw = process.env.APP_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_API_BASE_URL ||
        "";
    const normalized = normalizePublicUrl(raw);
    return normalized ? normalized.replace(/\/+$/g, "") : "";
}
function getSafePublicReturnUrl(raw) {
    const normalized = normalizePublicUrl(raw, { allowRelative: true });
    if (normalized)
        return normalized;
    return getPublicReturnUrlFromEnv();
}
