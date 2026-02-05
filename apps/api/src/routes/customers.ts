import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiPublicKey } from "../services/runtimeConfig";

const createCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  metadata: z.any().optional()
});

const wompiPaymentSourceSchema = z.object({
  type: z.enum(["CARD", "NEQUI", "PSE"]).default("CARD"),
  token: z.string().min(1)
});

export const customersRouter = express.Router();

customersRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const takeRaw = Number(req?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const q = String(req?.query?.q ?? "").trim();

  const items = await prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take });
  if (!q) return res.json({ items });

  const t = q.toLowerCase();
  const filtered = items.filter((c) => {
    const meta = (c.metadata ?? {}) as any;
    const hay =
      String(c.name || "").toLowerCase().includes(t) ||
      String(c.email || "").toLowerCase().includes(t) ||
      String(c.phone || "").toLowerCase().includes(t) ||
      String(meta.identificacion || "").toLowerCase().includes(t) ||
      String(meta.identificacionNumero || "").toLowerCase().includes(t);
    return hay;
  });

  res.json({ items: filtered });
});

customersRouter.post("/", async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const customer = await prisma.customer.create({ data: parsed.data as any });
  res.status(201).json({ customer });
});

customersRouter.post("/:id/wompi/payment-source", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  const parsed = wompiPaymentSourceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });
  if (!customer.email) return res.status(400).json({ error: "customer_email_required" });

  const publicKey = await getWompiPublicKey();
  if (!publicKey) return res.status(400).json({ error: "wompi_public_key_not_configured" });
  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return res.status(400).json({ error: "wompi_private_key_not_configured" });

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey, checkoutLinkBaseUrl });
  const merchant = await wompi.getMerchant(publicKey);

  const created = await wompi.createPaymentSource({
    type: parsed.data.type,
    token: parsed.data.token,
    customer_email: customer.email,
    acceptance_token: merchant.acceptanceToken,
    accept_personal_auth: merchant.acceptPersonalAuth
  });

  const existing = (customer.metadata ?? {}) as any;
  const merged = {
    ...(existing && typeof existing === "object" ? existing : {}),
    wompi: {
      ...(existing?.wompi && typeof existing.wompi === "object" ? existing.wompi : {}),
      paymentSourceId: created.id,
      paymentSourceType: parsed.data.type,
      acceptancePermalink: merchant.acceptancePermalink,
      personalDataPermalink: merchant.personalDataPermalink,
      createdAt: new Date().toISOString()
    }
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { metadata: merged as any }
  });

  res.status(201).json({ customer: updated, paymentSourceId: created.id });
});
