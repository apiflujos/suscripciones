import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { ChatwootMessageType, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { loadEnv } from "../config/env";
import { WompiClient } from "../providers/wompi/client";

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

  const cycle = sub.currentCycle;
  const reference = `SUB_${sub.id}_${cycle}`;
  const amountInCents = parsed.data.amountInCents ?? sub.plan.priceInCents;

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
      subscriptionCycleKey
    },
    update: {
      amountInCents,
      currency: sub.plan.currency,
      reference,
      status: PaymentStatus.PENDING
    }
  });

  const wompi = new WompiClient({
    apiBaseUrl: env.WOMPI_API_BASE_URL,
    privateKey: env.WOMPI_PRIVATE_KEY,
    checkoutLinkBaseUrl: env.WOMPI_CHECKOUT_LINK_BASE_URL
  });

  try {
    const created = await wompi.createPaymentLink({
      name: `Suscripción ${sub.plan.name}`,
      description: `Suscripción ${sub.id} (ciclo ${cycle})`,
      single_use: true,
      collect_shipping: false,
      currency: sub.plan.currency,
      amount_in_cents: amountInCents,
      redirect_url: env.WOMPI_REDIRECT_URL || undefined,
      sku: payment.id
    });

    await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNo: 0,
        status: "PAYMENT_LINK_CREATED",
        provider: "wompi",
        response: created.raw as any
      }
    });

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        wompiPaymentLinkId: created.id,
        checkoutUrl: created.checkoutUrl
      }
    });

    const chatwootConfigured =
      !!env.CHATWOOT_BASE_URL && !!env.CHATWOOT_API_ACCESS_TOKEN && !!env.CHATWOOT_ACCOUNT_ID && !!env.CHATWOOT_INBOX_ID;

    if (chatwootConfigured) {
      const recentlySent = await prisma.chatwootMessage.findFirst({
        where: {
          paymentId: updated.id,
          type: ChatwootMessageType.PAYMENT_LINK,
          status: "SENT",
          createdAt: { gt: new Date(Date.now() - 10 * 60_000) }
        }
      });

      if (!recentlySent) {
        const msg = await prisma.chatwootMessage.create({
          data: {
            customerId: sub.customerId,
            subscriptionId: sub.id,
            paymentId: updated.id,
            type: ChatwootMessageType.PAYMENT_LINK,
            content: `Link de pago (ciclo ${cycle}): ${updated.checkoutUrl}`
          }
        });
        await prisma.retryJob.create({
          data: {
            type: RetryJobType.SEND_CHATWOOT_MESSAGE,
            payload: { chatwootMessageId: msg.id }
          }
        });
      }
    }

    res.status(201).json({ paymentId: updated.id, wompiPaymentLinkId: created.id, checkoutUrl: updated.checkoutUrl });
  } catch (err: any) {
    await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNo: 0,
        status: "PAYMENT_LINK_CREATE_FAILED",
        provider: "wompi",
        errorMessage: err?.message ? String(err.message) : "unknown error"
      }
    });
    res.status(502).json({ error: "wompi_payment_link_failed" });
  }
});
