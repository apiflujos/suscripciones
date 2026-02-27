import express from "express";
import { prisma } from "../db/prisma";
import { getCredential, getCredentialsBulk } from "../services/credentials";
import { CredentialProvider } from "@prisma/client";
import { getCheckoutBaseUrlsFromEnv } from "../services/publicBase";

export const publicLinksRouter = express.Router();

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
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}
  const envBases = getCheckoutBaseUrlsFromEnv();
  const storedPlanBaseUrl = String(parsed?.planBaseUrl || "").trim();
  const storedSubscriptionBaseUrl = String(parsed?.subscriptionBaseUrl || "").trim();
  const wompiActiveEnv = (() => {
    const fromDb = wompiCreds.get("ACTIVE_ENV");
    const normalized = String(fromDb || "PRODUCTION")
      .trim()
      .toUpperCase();
    return normalized === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  })();
  const getWompi = (key: string, env: "SANDBOX" | "PRODUCTION") =>
    wompiCreds.get(`${key}_${env}`) || wompiCreds.get(key) || "";
  const wompiPublicKey = String(getWompi("PUBLIC_KEY", wompiActiveEnv as any) || "").trim();
  const wompiApiBaseUrl = String(getWompi("API_BASE_URL", wompiActiveEnv as any) || "").trim();
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

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["paymentLink", "token"], equals: token } as any }
  });
  if (!customer) return res.status(404).json({ error: "not_found" });

  const meta: any = customer.metadata || {};
  const link = meta?.paymentLink || {};
  const expiresAt = link?.expiresAt ? new Date(String(link.expiresAt)) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "expired" });
  }

  const templateId = String(link?.templateId || "").trim();
  const template = templateId
    ? await prisma.publicCheckoutTemplate.findUnique({ where: { id: templateId } })
    : null;

  res.json({
    ok: true,
    checkoutUrl: String(link?.checkoutUrl || ""),
    customer: {
      id: customer.id,
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || ""
    },
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
