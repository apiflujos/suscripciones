import { getCredential, getCredentialsBulk } from "@suscripciones/core/services/credentials";
import { CredentialProvider } from "@prisma/client";
import { getCheckoutBaseUrlsFromEnv, getPublicReturnUrlFromEnv } from "@suscripciones/core/services/publicBase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutConfig = {
  planBaseUrl?: string;
  subscriptionBaseUrl?: string;
  defaultUtmParams?: string;
  tokenExpiryHours?: number;
  logoUrl?: string;
  supportEmail?: string;
  supportUrl?: string;
  planTitle?: string;
  planDescription?: string;
  subscriptionTitle?: string;
  subscriptionDescription?: string;
  planWompiTitle?: string;
  planWompiDescription?: string;
  subscriptionWompiTitle?: string;
  subscriptionWompiDescription?: string;
  tokenizationSuccessTitle?: string;
  tokenizationSuccessMessage?: string;
  tokenizationErrorMessage?: string;
  tokenizationReturnUrl?: string;
};

export async function GET() {
  const [raw, wompiCreds] = await Promise.all([
    getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG"),
    getCredentialsBulk(CredentialProvider.WOMPI, [
      "ACTIVE_ENV",
      "PUBLIC_KEY",
      "PUBLIC_KEY_PRODUCTION",
      "PUBLIC_KEY_SANDBOX",
      "API_BASE_URL",
      "API_BASE_URL_PRODUCTION",
      "API_BASE_URL_SANDBOX"
    ])
  ]);
  let parsed: CheckoutConfig | null = null;
  try {
    const json = raw ? JSON.parse(raw) : null;
    parsed = json && typeof json === "object" ? (json as CheckoutConfig) : null;
  } catch {
    parsed = null;
  }
  const envBases = getCheckoutBaseUrlsFromEnv();
  const storedPlanBaseUrl = String(parsed?.planBaseUrl || "").trim();
  const storedSubscriptionBaseUrl = String(parsed?.subscriptionBaseUrl || "").trim();
  const storedReturnUrl = String(parsed?.tokenizationReturnUrl || "").trim();
  const wompiActiveEnv: "SANDBOX" | "PRODUCTION" = (() => {
    const fromDb = wompiCreds.get("ACTIVE_ENV");
    const normalized = String(fromDb || "PRODUCTION")
      .trim()
      .toUpperCase();
    return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  })();
  const getWompi = (key: string, env: "SANDBOX" | "PRODUCTION") => wompiCreds.get(`${key}_${env}`) || wompiCreds.get(key) || "";
  const wompiPublicKey = String(getWompi("PUBLIC_KEY", wompiActiveEnv) || "").trim();
  const wompiApiBaseUrl = String(getWompi("API_BASE_URL", wompiActiveEnv) || "").trim();
  const config = {
    planBaseUrl: storedPlanBaseUrl || envBases.planBaseUrl,
    subscriptionBaseUrl: storedSubscriptionBaseUrl || envBases.subscriptionBaseUrl,
    defaultUtmParams: String(parsed?.defaultUtmParams || "").trim() || "",
    tokenExpiryHours: Number(parsed?.tokenExpiryHours || 24),
    logoUrl: String(parsed?.logoUrl || "").trim() || null,
    supportEmail: String(parsed?.supportEmail || "").trim() || null,
    supportUrl: String(parsed?.supportUrl || "").trim() || null,
    planTitle: String(parsed?.planTitle || "").trim() || "Paga tu plan",
    planDescription: String(parsed?.planDescription || "").trim() || "",
    subscriptionTitle: String(parsed?.subscriptionTitle || "").trim() || "Activa tu suscripción",
    subscriptionDescription: String(parsed?.subscriptionDescription || "").trim() || "",
    planWompiTitle: String(parsed?.planWompiTitle || "").trim() || "",
    planWompiDescription: String(parsed?.planWompiDescription || "").trim() || "",
    subscriptionWompiTitle: String(parsed?.subscriptionWompiTitle || "").trim() || "",
    subscriptionWompiDescription: String(parsed?.subscriptionWompiDescription || "").trim() || "",
    tokenizationSuccessTitle: String(parsed?.tokenizationSuccessTitle || "").trim() || "",
    tokenizationSuccessMessage: String(parsed?.tokenizationSuccessMessage || "").trim() || "",
    tokenizationErrorMessage: String(parsed?.tokenizationErrorMessage || "").trim() || "",
    tokenizationReturnUrl: storedReturnUrl || getPublicReturnUrlFromEnv() || "",
    publicReturnUrl: getPublicReturnUrlFromEnv(),
    wompiActiveEnv,
    wompiPublicKey: wompiPublicKey || null,
    wompiApiBaseUrl: wompiApiBaseUrl || null
  };
  return Response.json({ ok: true, config });
}
