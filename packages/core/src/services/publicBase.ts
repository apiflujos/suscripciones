function ensureHttps(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

export function getCheckoutBaseUrlsFromEnv(): { planBaseUrl: string | null; subscriptionBaseUrl: string | null; cartBaseUrl: string | null } {
  const base = getPublicBaseUrlFromEnv();
  if (!base) return { planBaseUrl: null, subscriptionBaseUrl: null, cartBaseUrl: null };
  return {
    planBaseUrl: `${base}/public/plan`,
    subscriptionBaseUrl: `${base}/public/suscripcion`,
    cartBaseUrl: `${base}/public/cart`
  };
}

export function getPublicReturnUrlFromEnv(): string | null {
  const base = getPublicBaseUrlFromEnv();
  if (!base) return null;
  return `${base}/public/return`;
}

function isUnsafeLocalHost(hostname: string): boolean {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

export function normalizePublicUrl(raw?: string | null, opts?: { allowRelative?: boolean; allowLocalhost?: boolean }) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (opts?.allowRelative && value.startsWith("/")) return value;
  try {
    const parsed = new URL(ensureHttps(value));
    if (!opts?.allowLocalhost && isUnsafeLocalHost(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function getPublicBaseUrlFromEnv(): string {
  const raw =
    process.env.APP_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "";
  const normalized = normalizePublicUrl(raw);
  return normalized ? normalized.replace(/\/+$/g, "") : "";
}

export function getSafePublicReturnUrl(raw?: string | null): string | null {
  const normalized = normalizePublicUrl(raw, { allowRelative: true });
  if (normalized) return normalized;
  return getPublicReturnUrlFromEnv();
}
