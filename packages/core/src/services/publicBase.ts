export function getPublicBaseUrlFromEnv(): string {
  const raw =
    process.env.APP_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "";
  return String(raw || "").trim().replace(/\/+$/g, "");
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

export function getSafePublicReturnUrl(raw?: string | null): string | null {
  const value = String(raw || "").trim();
  if (value) {
    try {
      const parsed = new URL(value);
      if (!isUnsafeLocalHost(parsed.hostname)) return parsed.toString();
    } catch {
      if (value.startsWith("/")) return value;
    }
  }
  return getPublicReturnUrlFromEnv();
}
