import express from "express";
import { prisma } from "../db/prisma";
import { getCredential } from "../services/credentials";
import { CredentialProvider } from "@prisma/client";

export const publicLinksRouter = express.Router();

publicLinksRouter.get("/checkout-config", async (_req, res) => {
  const raw = (await getCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG")) || "";
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}
  const config = {
    planBaseUrl: String(parsed?.planBaseUrl || "").trim() || null,
    subscriptionBaseUrl: String(parsed?.subscriptionBaseUrl || "").trim() || null,
    tokenExpiryHours: Number(parsed?.tokenExpiryHours || 24),
    logoUrl: String(parsed?.logoUrl || "").trim() || null,
    planTitle: String(parsed?.planTitle || "").trim() || "Paga tu plan",
    planDescription: String(parsed?.planDescription || "").trim() || "",
    subscriptionTitle: String(parsed?.subscriptionTitle || "").trim() || "Activa tu suscripción",
    subscriptionDescription: String(parsed?.subscriptionDescription || "").trim() || ""
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

  res.json({
    ok: true,
    checkoutUrl: String(link?.checkoutUrl || ""),
    customer: {
      id: customer.id,
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || ""
    }
  });
});
