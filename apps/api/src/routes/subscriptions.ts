import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { LogLevel, PaymentStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { systemLog } from "../services/systemLog";
import { createPaymentLinkForSubscription } from "../services/subscriptionBilling";
import { scheduleSubscriptionDueNotifications } from "../services/notificationsScheduler";
import { consumeApp } from "../services/superAdminApp";

const createSubscriptionSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid(),
  startAt: z.string().datetime().optional(),
  firstPeriodEndAt: z.string().datetime().optional(),
  createPaymentLink: z.boolean().optional().default(false)
});

export const subscriptionsRouter = express.Router();

subscriptionsRouter.get("/", async (_req, res) => {
  const items = await prisma.subscription.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { customer: true, plan: true }
  });
  const subscriptionIds = items.map((s) => s.id);
  const approvedPayments = await prisma.payment.findMany({
    where: { subscriptionId: { in: subscriptionIds }, status: PaymentStatus.APPROVED, paidAt: { not: null } },
    orderBy: { paidAt: "desc" },
    select: { subscriptionId: true, paidAt: true, amountInCents: true, currency: true }
  });

  const lastPaymentBySub = new Map<string, { paidAt: Date; amountInCents: number; currency: string }>();
  for (const p of approvedPayments) {
    if (!p.subscriptionId || !p.paidAt) continue;
    if (!lastPaymentBySub.has(p.subscriptionId)) lastPaymentBySub.set(p.subscriptionId, { paidAt: p.paidAt, amountInCents: p.amountInCents, currency: p.currency });
  }

  res.json({
    items: items.map((s) => ({
      ...s,
      lastPayment: lastPaymentBySub.get(s.id) ?? null
    }))
  });
});

subscriptionsRouter.post("/", async (req, res) => {
  const parsed = createSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: parsed.data.planId } });
  if (!plan) return res.status(404).json({ error: "plan_not_found" });

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });

  const collectionMode = String((plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  const paymentSourceId = Number((customer.metadata as any)?.wompi?.paymentSourceId);
  const hasPaymentSource = Number.isFinite(paymentSourceId);
  const hasCustomerEmail = !!customer.email;

  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date();
  const computedEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const periodEnd = parsed.data.firstPeriodEndAt ? new Date(parsed.data.firstPeriodEndAt) : computedEnd;
  if (Number.isNaN(periodEnd.getTime())) return res.status(400).json({ error: "invalid_first_period_end_at" });
  if (periodEnd < startAt) return res.status(400).json({ error: "first_period_end_must_be_after_start" });

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

  await consumeApp("subscriptions_created", { amount: 1, source: "api:subscriptions.create", meta: { subscriptionId: subscription.id, planId: plan.id } });
  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  const runAt = periodEnd <= new Date(Date.now() + 5_000) ? new Date() : periodEnd;

  // AUTO_* modes schedule work to happen at the cutoff/charge time.
  if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
    await prisma.retryJob
      .create({
        data: {
          type: RetryJobType.PAYMENT_RETRY,
          runAt,
          payload: { subscriptionId: subscription.id }
        }
      })
      .catch(() => {});

    // If requested, generate a link right away (useful for first charge or missing token).
    const isDueNow = runAt.getTime() <= Date.now() + 5_000;
    const shouldCreateLinkNow =
      (collectionMode === "AUTO_LINK" ? parsed.data.createPaymentLink && isDueNow : false) ||
      (collectionMode === "AUTO_DEBIT" && (!hasPaymentSource || !hasCustomerEmail));

    if (!shouldCreateLinkNow) return res.status(201).json({ subscription, scheduled: true });

    try {
      const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
      return res.status(201).json({ subscription, scheduled: true, ...link, paymentSourceMissing: collectionMode === "AUTO_DEBIT" && !hasPaymentSource });
    } catch (err: any) {
      await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
        subscriptionId: subscription.id,
        err: err?.message ? String(err.message) : "unknown error"
      }).catch(() => {});
      return res.status(201).json({ subscription, scheduled: true, paymentLinkError: "wompi_payment_link_failed" });
    }
  }

  if (!parsed.data.createPaymentLink) return res.status(201).json({ subscription });

  try {
    const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
    return res.status(201).json({ subscription, ...link });
  } catch (err: any) {
    await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
      subscriptionId: subscription.id,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    await prisma.retryJob
      .create({
        data: {
          type: RetryJobType.PAYMENT_RETRY,
          payload: { subscriptionId: subscription.id }
        }
      })
      .catch(() => {});
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
