import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { PaymentStatus, RetryJobType } from "@prisma/client";
import { WompiClient } from "../providers/wompi/client";
import { getChatwootConfig, getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiRedirectUrl } from "../services/runtimeConfig";
import { ensureChatwootContactForCustomer, syncChatwootAttributesForCustomer } from "../services/chatwootSync";
import { schedulePaymentLinkNotifications } from "../services/notificationsScheduler";

const lineItemSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  unitPriceInCents: z.number().int().nonnegative()
});

const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  reference: z.string().min(1),
  currency: z.string().min(3).max(3).default("COP"),
  expiresAt: z.string().datetime().optional(),
  discountType: z.enum(["NONE", "FIXED", "PERCENT"]).optional().default("NONE"),
  discountValueInCents: z.number().int().nonnegative().optional().default(0),
  discountPercent: z.number().int().min(0).max(100).optional().default(0),
  taxPercent: z.number().int().min(0).max(100).optional().default(0),
  lineItems: z.array(lineItemSchema).min(1),
  sendChatwoot: z.boolean().optional().default(true),
  source: z.enum(["SHOPIFY", "ALEGRA", "MANUAL"]).optional().default("MANUAL")
});

function computeTotals(input: z.infer<typeof createOrderSchema>) {
  const subtotal = input.lineItems.reduce((acc, li) => acc + li.unitPriceInCents * li.quantity, 0);
  const discountBase = subtotal;
  const discount =
    input.discountType === "FIXED"
      ? Math.min(input.discountValueInCents, discountBase)
      : input.discountType === "PERCENT"
        ? Math.trunc((discountBase * input.discountPercent) / 100)
        : 0;
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = input.taxPercent ? Math.trunc((afterDiscount * input.taxPercent) / 100) : 0;
  const total = afterDiscount + tax;
  return { subtotal, discount, tax, total };
}

export const ordersRouter = express.Router();

ordersRouter.get("/", async (_req, res) => {
  const items = await prisma.payment.findMany({
    where: { subscriptionId: null, wompiPaymentLinkId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      customer: true,
      chatwootMsgs: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  res.json({ items });
});

ordersRouter.post("/", async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });

  const totals = computeTotals(parsed.data);

  const payment = await prisma.payment.create({
    data: {
      customerId: customer.id,
      subscriptionId: null,
      amountInCents: totals.total,
      currency: parsed.data.currency,
      reference: `ORDER_${parsed.data.reference}`,
      status: PaymentStatus.PENDING,
      providerResponse: {
        order: {
          source: parsed.data.source,
          reference: parsed.data.reference,
          lineItems: parsed.data.lineItems,
          totals,
          taxPercent: parsed.data.taxPercent,
          discountType: parsed.data.discountType,
          discountValueInCents: parsed.data.discountValueInCents,
          discountPercent: parsed.data.discountPercent,
          expiresAt: parsed.data.expiresAt || null
        }
      } as any
    }
  });

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) return res.status(400).json({ error: "wompi_private_key_not_configured" });

  const wompi = new WompiClient({
    apiBaseUrl: await getWompiApiBaseUrl(),
    privateKey,
    checkoutLinkBaseUrl: await getWompiCheckoutLinkBaseUrl()
  });

  const redirectUrl = await getWompiRedirectUrl();
  const customerName = customer.name || "Cliente";
  const itemName = parsed.data.lineItems?.[0]?.name ? String(parsed.data.lineItems[0].name) : "Producto";
  const created = await wompi.createPaymentLink({
    name: `Pago a ${customerName}`,
    description: itemName,
    single_use: true,
    collect_shipping: false,
    currency: parsed.data.currency,
    amount_in_cents: totals.total,
    expires_at: parsed.data.expiresAt,
    redirect_url: redirectUrl,
    sku: payment.id
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      wompiPaymentLinkId: created.id,
      checkoutUrl: created.checkoutUrl
    }
  });

  await schedulePaymentLinkNotifications({ paymentId: updated.id }).catch(() => {});

  if (parsed.data.sendChatwoot) {
    const chatwoot = await getChatwootConfig();
    if (chatwoot.configured) {
      await ensureChatwootContactForCustomer(customer.id).catch(() => {});
      await syncChatwootAttributesForCustomer(customer.id).catch(() => {});
    }
  }

  res.status(201).json({ payment: updated, checkoutUrl: updated.checkoutUrl });
});
