import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { PaymentStatus, SubscriptionStatus } from "@prisma/client";
import { loadEnv } from "../config/env";

const createSubscriptionSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid(),
  startAt: z.string().datetime().optional()
});

export const subscriptionsRouter = express.Router();

subscriptionsRouter.get("/", async (_req, res) => {
  const items = await prisma.subscription.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { customer: true, plan: true }
  });
  res.json({ items });
});

subscriptionsRouter.post("/", async (req, res) => {
  const parsed = createSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: parsed.data.planId } });
  if (!plan) return res.status(404).json({ error: "plan_not_found" });

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });

  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date();
  const periodEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);

  const subscription = await prisma.subscription.create({
    data: {
      customerId: parsed.data.customerId,
      planId: plan.id,
      status: SubscriptionStatus.PAST_DUE,
      startAt,
      currentPeriodStartAt: startAt,
      currentPeriodEndAt: periodEnd,
      currentCycle: 1
    }
  });
  res.status(201).json({ subscription });
});

const createPaymentLinkSchema = z.object({
  // Optional override in case you want to bill a different amount
  amountInCents: z.number().int().positive().optional()
});

subscriptionsRouter.post("/:id/payment-link", async (req, res) => {
  const env = loadEnv(process.env);
  const subscriptionId = req.params.id;

  const parsed = createPaymentLinkSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, customer: true }
  });
  if (!sub) return res.status(404).json({ error: "subscription_not_found" });
  if (sub.status === SubscriptionStatus.CANCELED) return res.status(409).json({ error: "subscription_canceled" });

  const publicKey = (env.WOMPI_PUBLIC_KEY || "").trim();
  const checkoutBase = (env.WOMPI_CHECKOUT_BASE_URL || "https://checkout.wompi.co/p/").trim();
  if (!publicKey) return res.status(400).json({ error: "missing_wompi_public_key" });

  const cycle = sub.currentCycle;
  const reference = `SUB_${sub.id}_${cycle}`;
  const amountInCents = parsed.data.amountInCents ?? sub.plan.priceInCents;

  const checkoutUrl = new URL(checkoutBase);
  checkoutUrl.searchParams.set("public-key", publicKey);
  checkoutUrl.searchParams.set("currency", sub.plan.currency);
  checkoutUrl.searchParams.set("amount-in-cents", String(amountInCents));
  checkoutUrl.searchParams.set("reference", reference);
  if (env.WOMPI_REDIRECT_URL) checkoutUrl.searchParams.set("redirect-url", env.WOMPI_REDIRECT_URL);

  const subscriptionCycleKey = `${sub.id}:${cycle}`;
  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      customerId: sub.customerId,
      subscriptionId: sub.id,
      amountInCents,
      currency: sub.plan.currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.PENDING,
      checkoutUrl: checkoutUrl.toString(),
      subscriptionCycleKey
    },
    update: {
      amountInCents,
      currency: sub.plan.currency,
      reference,
      status: PaymentStatus.PENDING,
      checkoutUrl: checkoutUrl.toString()
    }
  });

  res.status(201).json({ paymentId: payment.id, reference, checkoutUrl: payment.checkoutUrl });
});
