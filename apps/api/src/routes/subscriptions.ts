import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { ChatwootMessageType, LogLevel, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { WompiClient } from "../providers/wompi/client";
import { getChatwootConfig, getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPrivateKey, getWompiRedirectUrl } from "../services/runtimeConfig";
import { systemLog } from "../services/systemLog";

const createSubscriptionSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid(),
  startAt: z.string().datetime().optional(),
  createPaymentLink: z.boolean().optional().default(false)
});

export const subscriptionsRouter = express.Router();

async function createPaymentLinkForSubscription(args: {
  subscriptionId: string;
  amountInCentsOverride?: number;
}): Promise<{ paymentId: string; wompiPaymentLinkId: string; checkoutUrl: string }> {
  const sub = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true, customer: true }
  });
  if (!sub) throw new Error("subscription_not_found");
  if (sub.status === SubscriptionStatus.CANCELED) throw new Error("subscription_canceled");

  const cycle = sub.currentCycle;
  const reference = `SUB_${sub.id}_${cycle}`;
  const amountInCents = args.amountInCentsOverride ?? sub.plan.priceInCents;

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

  if (payment.checkoutUrl && payment.wompiPaymentLinkId) {
    return {
      paymentId: payment.id,
      wompiPaymentLinkId: payment.wompiPaymentLinkId,
      checkoutUrl: payment.checkoutUrl
    };
  }

  const privateKey = await getWompiPrivateKey();
  if (!privateKey) throw new Error("wompi_private_key_not_configured");

  const wompi = new WompiClient({
    apiBaseUrl: await getWompiApiBaseUrl(),
    privateKey,
    checkoutLinkBaseUrl: await getWompiCheckoutLinkBaseUrl()
  });

  let created: Awaited<ReturnType<WompiClient["createPaymentLink"]>>;
  try {
    const redirectUrl = await getWompiRedirectUrl();
    created = await wompi.createPaymentLink({
      name: `Suscripción ${sub.plan.name}`,
      description: `Suscripción ${sub.id} (ciclo ${cycle})`,
      single_use: true,
      collect_shipping: false,
      currency: sub.plan.currency,
      amount_in_cents: amountInCents,
      redirect_url: redirectUrl,
      sku: payment.id
    });
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
    await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
      subscriptionId: sub.id,
      paymentId: payment.id,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    throw err;
  }

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

  await systemLog(LogLevel.INFO, "subscriptions.payment_link", "Payment link created", {
    subscriptionId: sub.id,
    paymentId: updated.id,
    wompiPaymentLinkId: created.id
  }).catch(() => {});

  const chatwoot = await getChatwootConfig();
  if (chatwoot.configured) {
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

  if (!updated.checkoutUrl) throw new Error("checkout_url_missing");
  return { paymentId: updated.id, wompiPaymentLinkId: created.id, checkoutUrl: updated.checkoutUrl };
}

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
  if (!parsed.data.createPaymentLink) return res.status(201).json({ subscription });

  try {
    const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
    return res.status(201).json({ subscription, ...link });
  } catch (err: any) {
    await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
      subscriptionId: subscription.id,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    return res.status(201).json({ subscription, paymentLinkError: "wompi_payment_link_failed" });
  }
});

const createPaymentLinkSchema = z.object({
  // Optional override in case you want to bill a different amount
  amountInCents: z.number().int().positive().optional()
});

subscriptionsRouter.post("/:id/payment-link", async (req, res) => {
  const subscriptionId = req.params.id;

  const parsed = createPaymentLinkSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const link = await createPaymentLinkForSubscription({
      subscriptionId,
      amountInCentsOverride: parsed.data.amountInCents
    });
    res.status(201).json(link);
  } catch (err: any) {
    await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
      subscriptionId,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    res.status(502).json({ error: "wompi_payment_link_failed" });
  }
});
