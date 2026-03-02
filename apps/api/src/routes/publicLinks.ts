import express from "express";
import { prisma } from "../db/prisma";
import { getCredential, getCredentialsBulk } from "../services/credentials";
import { CredentialProvider, LogLevel } from "@prisma/client";
import { getCheckoutBaseUrlsFromEnv } from "../services/publicBase";
import { getTenantBrand } from "../services/tenantBrand";
import { systemLog } from "../services/systemLog";

export const publicLinksRouter = express.Router();

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

type PaymentLinkMeta = {
  token?: string;
  expiresAt?: string;
  templateId?: string;
  checkoutUrl?: string;
};

publicLinksRouter.get("/checkout-config", async (_req, res) => {
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
  const wompiActiveEnv: "SANDBOX" | "PRODUCTION" = (() => {
    const fromDb = wompiCreds.get("ACTIVE_ENV");
    const normalized = String(fromDb || "PRODUCTION")
      .trim()
      .toUpperCase();
    return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  })();
  const getWompi = (key: string, env: "SANDBOX" | "PRODUCTION") =>
    wompiCreds.get(`${key}_${env}`) || wompiCreds.get(key) || "";
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
    tokenizationReturnUrl: String(parsed?.tokenizationReturnUrl || "").trim() || "",
    wompiActiveEnv,
    wompiPublicKey: wompiPublicKey || null,
    wompiApiBaseUrl: wompiApiBaseUrl || null
  };
  res.json({ ok: true, config });
});

publicLinksRouter.get("/payment-links/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "invalid_token" });

  const ip = String((req.headers["x-forwarded-for"] as string) || req.ip || "").split(",")[0].trim();

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["paymentLink", "token"], equals: token } as any }
  });
  if (!customer) {
    void systemLog(LogLevel.WARN, "public.payment_link", "payment_link_not_found", {
      token,
      ip,
      userAgent: req.get("user-agent") || null
    }).catch(() => {});
    return res.status(404).json({ error: "not_found" });
  }

  const meta = (customer.metadata ?? {}) as { paymentLink?: PaymentLinkMeta };
  const link = meta?.paymentLink || {};
  const expiresAt = link?.expiresAt ? new Date(String(link.expiresAt)) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    void systemLog(LogLevel.WARN, "public.payment_link", "payment_link_expired", {
      token,
      tenantId: customer.tenantId,
      expiresAt: expiresAt.toISOString(),
      ip,
      userAgent: req.get("user-agent") || null
    }).catch(() => {});
    return res.status(410).json({ error: "expired" });
  }

  const templateId = String(link?.templateId || "").trim();
  let template = templateId
    ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
    : null;
  if (!template && customer.tenantId) {
    template = await prisma.publicCheckoutTemplate.findFirst({
      where: {
        tenantId: customer.tenantId,
        active: true,
        kind: "PLAN"
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  const tenant = await getTenantBrand(template?.tenantId || customer.tenantId || null);

  res.json({
    ok: true,
    checkoutUrl: String(link?.checkoutUrl || ""),
    customer: {
      id: customer.id,
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || ""
    },
    tenant,
    template: template
      ? {
          id: template.id,
          name: template.name,
          kind: template.kind,
          logoUrl: template.logoUrl || null,
          publicTitle: template.publicTitle || null,
          publicDescription: template.publicDescription || null,
          wompiTitle: template.wompiTitle || null,
          wompiDescription: template.wompiDescription || null,
          layout: template.layout || null
        }
      : null
  });
});
