export function getPublicBaseUrlFromEnv(): string {
  const raw =
    process.env.APP_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_HOST ||
    "";
  return String(raw || "").trim().replace(/\/+$/g, "");
}

export function getCheckoutBaseUrlsFromEnv(): { planBaseUrl: string | null; subscriptionBaseUrl: string | null } {
  const base = getPublicBaseUrlFromEnv();
  if (!base) return { planBaseUrl: null, subscriptionBaseUrl: null };
  return {
    planBaseUrl: `${base}/public/plan`,
    subscriptionBaseUrl: `${base}/public/suscripcion`
  };
}
