import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiPublicKey } from "../services/runtimeConfig";
import { ensureChatwootContactForCustomer, syncChatwootAttributesForCustomer } from "../services/chatwootSync";
import { consumeApp } from "../services/superAdminApp";

const createCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  metadata: z.any().optional()
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(6).optional().or(z.literal("")),
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
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const q = String(req?.query?.q ?? "").trim();

  const where: any = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { metadata: { path: ["identificacion"], string_contains: q } } as any,
      { metadata: { path: ["identificacionNumero"], string_contains: q } } as any,
      { metadata: { path: ["identificationNumber"], string_contains: q } } as any,
      { metadata: { path: ["documentNumber"], string_contains: q } } as any,
      { metadata: { path: ["document"], string_contains: q } } as any
    ];
  }

  const items = await prisma.customer.findMany({ where, orderBy: { createdAt: "desc" }, take });
  res.json({ items });
});

customersRouter.get("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });
  res.json({ customer });
});

customersRouter.post("/", async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const customer = await prisma.customer.create({ data: parsed.data as any });
  await consumeApp("customers_created", { amount: 1, source: "api:customers.create", meta: { customerId: customer.id } });
  await ensureChatwootContactForCustomer(customer.id).catch(() => {});
  await syncChatwootAttributesForCustomer(customer.id).catch(() => {});
  res.status(201).json({ customer });
});

customersRouter.put("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data: any = { ...parsed.data };
  if (data.name === "") data.name = null;
  if (data.email === "") data.email = null;
  if (data.phone === "") data.phone = null;

  try {
    const updated = await prisma.customer.update({ where: { id: customerId }, data });
    await ensureChatwootContactForCustomer(updated.id).catch(() => {});
    await syncChatwootAttributesForCustomer(updated.id).catch(() => {});
    res.json({ customer: updated });
  } catch (err: any) {
    if (String(err?.code) === "P2025") return res.status(404).json({ error: "customer_not_found" });
    throw err;
  }
});

customersRouter.delete("/:id", async (req, res) => {
  const customerId = String(req.params.id || "").trim();
  if (!customerId) return res.status(400).json({ error: "invalid_id" });
  try {
    await prisma.customer.delete({ where: { id: customerId } });
    res.json({ ok: true });
  } catch (err: any) {
    if (String(err?.code) === "P2025") return res.status(404).json({ error: "customer_not_found" });
    if (String(err?.code) === "P2003") return res.status(409).json({ error: "customer_has_dependencies" });
    throw err;
  }
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
