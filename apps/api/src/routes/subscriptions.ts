import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { LogLevel, PaymentStatus, RetryJobStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { systemLog } from "../services/systemLog";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription } from "../services/subscriptionBilling";
import { scheduleSubscriptionDueNotifications } from "../services/notificationsScheduler";
import { consumeApp } from "../services/superAdminApp";
import { getEffectiveTenantId, getEffectiveTenantIds, readTenantIdsFromReq } from "../services/tenantContext";

const createSubscriptionSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid(),
  startAt: z.string().datetime().optional(),
  firstPeriodEndAt: z.string().datetime().optional(),
  createPaymentLink: z.boolean().optional().default(false),
  metadata: z.record(z.any()).optional()
});

export const subscriptionsRouter = express.Router();

subscriptionsRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const tenantId = await getEffectiveTenantId(req);
  const takeRaw = Number(req?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const q = String(req?.query?.q ?? "").trim();
  const customerId = String(req?.query?.customerId ?? "").trim();
  const estado = String(req?.query?.estado ?? "").trim();
  const collectionMode = String(req?.query?.collectionMode ?? "").trim();

  const where: any = {};
  if (tenantId) {
    const tenantFilter = { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] };
    where.AND = Array.isArray(where.AND) ? [...where.AND, tenantFilter] : [tenantFilter];
  }
  if (estado === "mora") where.status = SubscriptionStatus.PAST_DUE;
  else if (estado === "si") where.status = SubscriptionStatus.ACTIVE;
  else if (estado === "no") where.status = { notIn: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] };

  if (customerId) {
    where.customerId = customerId;
  }

  if (collectionMode) {
    where.plan = { metadata: { path: ["collectionMode"], equals: collectionMode } } as any;
  }

  if (q) {
    where.customer = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { metadata: { path: ["identificacion"], string_contains: q } } as any,
        { metadata: { path: ["identificacionNumero"], string_contains: q } } as any,
        { metadata: { path: ["documentNumber"], string_contains: q } } as any,
        { metadata: { path: ["document"], string_contains: q } } as any
      ]
    };
  }

  const items = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: { customer: true, plan: { include: { tenantLinks: true } }, tenantLinks: true }
  });
  const subscriptionIds = items.map((s: any) => s.id);
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

  const latestLinks = await prisma.paymentLink.findMany({
    where: { subscriptionId: { in: subscriptionIds } },
    orderBy: { sentAt: "desc" },
    select: { subscriptionId: true, sentAt: true, paidAt: true, status: true, checkoutUrl: true }
  });
  const lastLinkBySub = new Map<string, { sentAt: Date | null; paidAt: Date | null; status: string; checkoutUrl?: string | null }>();
  for (const l of latestLinks) {
    if (!l.subscriptionId) continue;
    if (!lastLinkBySub.has(l.subscriptionId)) {
      lastLinkBySub.set(l.subscriptionId, { sentAt: l.sentAt || null, paidAt: l.paidAt || null, status: l.status || "SENT", checkoutUrl: l.checkoutUrl || null });
    }
  }

  res.json({
    items: items.map((s: any) => ({
      ...s,
      tenantIds: Array.from(
        new Set([s.tenantId, ...(s.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))
      ) as string[],
      lastPayment: lastPaymentBySub.get(s.id) ?? null,
      lastPaymentLink: lastLinkBySub.get(s.id) ?? null
    }))
  });
});

subscriptionsRouter.post("/", async (req, res) => {
  const parsed = createSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: parsed.data.planId }, include: { tenantLinks: true } });
  if (!plan) return res.status(404).json({ error: "plan_not_found" });

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return res.status(404).json({ error: "customer_not_found" });
  const planTenantIds = Array.from(new Set([plan.tenantId, ...(plan.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[];
  const requestedTenantIds = readTenantIdsFromReq(req);
  const fallbackTenantIds = requestedTenantIds.length ? requestedTenantIds : planTenantIds;
  const effectiveTenantIds = fallbackTenantIds.length ? fallbackTenantIds : (await getEffectiveTenantIds(req));
  if (!effectiveTenantIds.length) return res.status(400).json({ error: "tenant_required" });

  if (planTenantIds.length) {
    const invalid = effectiveTenantIds.find((t) => !planTenantIds.includes(t));
    if (invalid) return res.status(409).json({ error: "tenant_not_allowed_for_plan" });
  }
  if (customer.tenantId && !effectiveTenantIds.includes(customer.tenantId)) {
    return res.status(409).json({ error: "tenant_mismatch" });
  }
  if (!customer.tenantId) {
    const linked = await prisma.customerTenant.findFirst({
      where: { customerId: customer.id, tenantId: { in: effectiveTenantIds } }
    });
    if (!linked) return res.status(409).json({ error: "tenant_mismatch" });
  }
  const tenantId = effectiveTenantIds[0];

  const collectionMode = String((plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  const paymentSourceId = (() => {
    const meta = (customer.metadata as any) ?? {};
    const candidates = [
      meta?.wompi?.paymentSourceId,
      meta?.wompi?.payment_source_id,
      meta?.paymentSourceId,
      meta?.payment_source_id
    ];
    for (const v of candidates) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    }
    return null;
  })();
  const hasPaymentSource = Number.isFinite(paymentSourceId as any);
  const hasCustomerEmail = !!customer.email;

  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date();
  const computedEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const periodEnd = parsed.data.firstPeriodEndAt ? new Date(parsed.data.firstPeriodEndAt) : computedEnd;
  if (Number.isNaN(periodEnd.getTime())) return res.status(400).json({ error: "invalid_first_period_end_at" });
  if (periodEnd < startAt) return res.status(400).json({ error: "first_period_end_must_be_after_start" });

  const subscription = await prisma.subscription.create({
    data: {
      tenantId,
      customerId: parsed.data.customerId,
      planId: plan.id,
      status: SubscriptionStatus.PAST_DUE,
      startAt,
      currentPeriodStartAt: startAt,
      currentPeriodEndAt: periodEnd,
      currentCycle: 1,
      ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {})
    }
  });
  await prisma.subscriptionTenant.createMany({
    data: effectiveTenantIds.map((t) => ({ subscriptionId: subscription.id, tenantId: t })),
    skipDuplicates: true
  });
  await prisma.customerTenant
    .createMany({ data: effectiveTenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
    .catch(() => {});

  await consumeApp("subscriptions_created", { amount: 1, source: "api:subscriptions.create", meta: { subscriptionId: subscription.id, planId: plan.id } });
  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  const runAt = periodEnd <= new Date(Date.now() + 5_000) ? new Date() : periodEnd;

  // AUTO_* modes: enqueue a single attempt at the cutoff date (no retries).
  if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
    await prisma.retryJob
      .create({
        data: {
          type: RetryJobType.PAYMENT_RETRY,
          runAt,
          maxAttempts: 1,
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
    return res.status(201).json({ subscription, paymentLinkError: "wompi_payment_link_failed" });
  }
});

const createPaymentLinkSchema = z.object({
  // Optional override in case you want to bill a different amount
  amountInCents: z.number().int().positive().optional()
});

const chargeNowSchema = z.object({
  amountInCents: z.number().int().positive().optional()
});

const scheduleCutoffSchema = z.object({
  cutoffAt: z.string().min(1)
});

const changePlanSchema = z.object({
  planId: z.string().uuid(),
  cutoffAt: z.string().min(1)
});

subscriptionsRouter.post("/:id/payment-link", async (req, res) => {
  const subscriptionId = req.params.id;

  const parsed = createPaymentLinkSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
    if (!existing) return res.status(404).json({ error: "subscription_not_found" });
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }
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

subscriptionsRouter.post("/:id/charge-now", async (req, res) => {
  const subscriptionId = req.params.id;
  const parsed = chargeNowSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const tenantId = await getEffectiveTenantId(req);
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, customer: true, tenantLinks: true }
  });
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });
  if (tenantId) {
    const allowed = subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const collectionMode = String((subscription.plan?.metadata as any)?.collectionMode || "MANUAL_LINK");
  if (collectionMode !== "AUTO_DEBIT") return res.status(409).json({ error: "manual_charge_not_allowed" });

  const meta = (subscription.customer?.metadata as any) ?? {};
  const paymentSource =
    meta?.wompi?.paymentSourceId ||
    meta?.wompi?.payment_source_id ||
    meta?.paymentSourceId ||
    meta?.payment_source_id;
  if (!paymentSource) return res.status(409).json({ error: "customer_payment_source_missing" });

  const manualChargeAt = new Date().toISOString();
  const nextMeta = {
    ...(subscription.metadata && typeof subscription.metadata === "object" ? subscription.metadata : {}),
    manualCharge: {
      at: manualChargeAt,
      cycle: subscription.currentCycle ?? 1
    }
  };
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { metadata: nextMeta as any }
  });

  try {
    const result = await createAutoDebitTransactionForSubscription({
      subscriptionId,
      amountInCentsOverride: parsed.data.amountInCents
    });
    res.status(201).json({ ok: true, ...result, manualChargeAt });
  } catch (err: any) {
    await systemLog(LogLevel.ERROR, "subscriptions.charge_now", "Manual charge failed", {
      subscriptionId,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    res.status(502).json({ error: err?.message || "charge_now_failed" });
  }
});

subscriptionsRouter.post("/:id/schedule-cutoff", async (req, res) => {
  const subscriptionId = req.params.id;
  const parsed = scheduleCutoffSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const cutoffAtRaw = String(parsed.data.cutoffAt || "").trim();
  const cutoffAt = new Date(cutoffAtRaw);
  if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return res.status(400).json({ error: "invalid_cutoff_date" });

  const tenantId = await getEffectiveTenantId(req);
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, tenantLinks: true }
  });
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });
  if (tenantId) {
    const allowed = subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const collectionMode = String((subscription.plan?.metadata as any)?.collectionMode || "MANUAL_LINK");
  if (collectionMode !== "AUTO_DEBIT") return res.status(409).json({ error: "schedule_cutoff_not_allowed" });

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { currentPeriodEndAt: cutoffAt }
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: { path: ["subscriptionId"], equals: subscriptionId } as any
    } as any
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.PAYMENT_RETRY,
        runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
        maxAttempts: 1,
        payload: { subscriptionId }
      }
    })
    .catch(() => {});

  res.status(200).json({ ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true });
});

subscriptionsRouter.post("/:id/change-plan", async (req, res) => {
  const subscriptionId = req.params.id;
  const parsed = changePlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const cutoffAtRaw = String(parsed.data.cutoffAt || "").trim();
  const cutoffAt = new Date(cutoffAtRaw);
  if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return res.status(400).json({ error: "invalid_cutoff_date" });

  const tenantId = await getEffectiveTenantId(req);
  const [subscription, plan] = await Promise.all([
    prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } }),
    prisma.subscriptionPlan.findUnique({ where: { id: parsed.data.planId }, include: { tenantLinks: true } })
  ]);
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });
  if (!plan) return res.status(404).json({ error: "plan_not_found" });
  if (tenantId) {
    const allowed = subscription.tenantId === tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
    const allowedPlan = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowedPlan) return res.status(404).json({ error: "plan_not_found" });
  }

  const now = new Date();
  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      planId: plan.id,
      currentCycle: 1,
      currentPeriodStartAt: now,
      currentPeriodEndAt: cutoffAt
    }
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: { path: ["subscriptionId"], equals: subscriptionId } as any
    } as any
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.PAYMENT_RETRY,
        runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
        maxAttempts: 1,
        payload: { subscriptionId }
      }
    })
    .catch(() => {});

  res.status(200).json({ ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true });
});

subscriptionsRouter.post("/:id/suspend", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }
  if (existing.status === SubscriptionStatus.CANCELED) return res.status(409).json({ error: "subscription_canceled" });

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: new Date() }
  });
  await systemLog(LogLevel.INFO, "subscriptions.suspend", "Subscription suspended", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.post("/:id/cancel", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), suspendedAt: null }
  });
  await systemLog(LogLevel.INFO, "subscriptions.cancel", "Subscription canceled", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.post("/:id/resume", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.ACTIVE, suspendedAt: null }
  });
  await systemLog(LogLevel.INFO, "subscriptions.resume", "Subscription resumed", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.post("/:id/activate", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubscriptionStatus.ACTIVE, canceledAt: null, suspendedAt: null }
  });
  await systemLog(LogLevel.INFO, "subscriptions.activate", "Subscription activated", { subscriptionId }).catch(() => {});
  res.json({ subscription: updated });
});

subscriptionsRouter.delete("/:id", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_id" });
  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "subscription_not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }
  const force = String((req as any)?.query?.force || "").trim() === "1";
  if (!force && existing.status !== SubscriptionStatus.CANCELED) {
    return res.status(409).json({ error: "subscription_must_be_canceled" });
  }

  const [paymentsCount, paymentLinksCount, chatwootCount] = await Promise.all([
    prisma.payment.count({ where: { subscriptionId } }),
    prisma.paymentLink.count({ where: { subscriptionId } }),
    prisma.chatwootMessage.count({ where: { subscriptionId } })
  ]);
  if (!force && (paymentsCount || paymentLinksCount || chatwootCount)) {
    return res.status(409).json({
      error: "subscription_has_dependencies",
      details: { paymentsCount, paymentLinksCount, chatwootCount }
    });
  }

  if (force) {
    const payments = await prisma.payment.findMany({ where: { subscriptionId }, select: { id: true } });
    const paymentIds = payments.map((p: any) => p.id);
    if (paymentIds.length) {
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
    }
    await prisma.paymentLink.deleteMany({ where: { subscriptionId } }).catch(() => {});
    await prisma.chatwootMessage.deleteMany({ where: { subscriptionId } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { subscriptionId } }).catch(() => {});
  }

  await prisma.subscription.delete({ where: { id: subscriptionId } });
  await systemLog(LogLevel.INFO, "subscriptions.delete", "Subscription deleted", { subscriptionId }).catch(() => {});
  res.json({ ok: true });
});
