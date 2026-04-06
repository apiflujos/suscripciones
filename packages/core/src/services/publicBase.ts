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
