import "server-only";

import { prisma } from "@suscripciones/database";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";
import { LogLevel, PaymentStatus, RetryJobStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { getAutoDebitConfig } from "@suscripciones/core/services/runtimeConfig";
import { addIntervalUtc } from "@suscripciones/core/lib/dates";
import { systemLog } from "@suscripciones/core/services/systemLog";
import {
  createAutoDebitTransactionForSubscription,
  createPaymentLinkForSubscription,
  readSubscriptionTotalInCents
} from "@suscripciones/core/services/subscriptionBilling";
import { reconcileWompiTransaction } from "@suscripciones/core/services/wompiReconcile";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { consumeApp } from "@suscripciones/core/services/superAdminApp";
import { validateWompiCurrency } from "@suscripciones/core/lib/wompiSignature";

function hasUsablePaymentSource(metadata: any) {
  const candidates = [
    metadata?.wompi?.paymentSourceId,
    metadata?.wompi?.payment_source_id,
    metadata?.paymentSourceId,
    metadata?.payment_source_id
  ];
  return candidates.some((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized) return false;
      if (/^(null|undefined)$/i.test(normalized)) return false;
      if (/^\d+$/.test(normalized)) return true;
      if (/^src[_-]/i.test(normalized)) return true;
      return normalized.length >= 6;
    }
    return false;
  });
}

function computePlanTotalInCents(args: {
  basePriceInCents: number;
  variantDeltaInCents: number;
  shippingInCents: number;
  discountType?: string | null;
  discountValueInCents?: number | null;
  discountPercent?: number | null;
  taxPercent?: number | null;
}) {
  const base = Number(args.basePriceInCents || 0);
  const delta = Number(args.variantDeltaInCents || 0);
  const shipping = Number(args.shippingInCents || 0);
  const discountType = String(args.discountType || "NONE");
  const discountValue = Number(args.discountValueInCents || 0);
  const discountPercent = Number(args.discountPercent || 0);
  const taxPercent = Number(args.taxPercent || 0);
  let subtotal = base + delta + shipping;
  if (discountType === "FIXED") subtotal -= discountValue;
  else if (discountType === "PERCENT") subtotal -= Math.round((subtotal * discountPercent) / 100);
  if (subtotal < 0) subtotal = 0;
  const taxInCents = Math.round((subtotal * taxPercent) / 100);
  return { subtotalInCents: subtotal, taxInCents, totalInCents: subtotal + taxInCents };
}

function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

async function recordManualChargeFailure(args: {
  subscription: any;
  amountInCentsOverride?: number;
  errorCode: string;
  details?: unknown;
}) {
  const subscription = args.subscription;
  const tenantId = subscription?.tenantId || subscription?.plan?.tenantId;
  if (!subscription?.id || !subscription?.customerId || !tenantId) return null;

  const cycle = Number(subscription.currentCycle || 1);
  const reference = `SUB_${subscription.id}_${cycle}`;
  const subscriptionCycleKey = `${subscription.id}:${cycle}`;
  const amountInCents = Math.trunc(args.amountInCentsOverride ?? readSubscriptionTotalInCents(subscription.metadata, subscription.plan?.priceInCents ?? 0));
  const currency = validateWompiCurrency(subscription.plan?.currency);
  const existing = await prisma.payment.findUnique({
    where: { subscriptionCycleKey },
    select: { id: true, status: true }
  });

  if (existing?.status === PaymentStatus.APPROVED) return existing.id;

  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      tenantId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      amountInCents,
      currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.ERROR,
      failedAt: new Date(),
      subscriptionCycleKey
    },
    update: {
      tenantId,
      amountInCents,
      currency,
      reference,
      status: PaymentStatus.ERROR,
      failedAt: new Date()
    }
  });

  const lastAttempt = await prisma.paymentAttempt.findFirst({
    where: { paymentId: payment.id },
    orderBy: [{ attemptNo: "desc" }, { createdAt: "desc" }],
    select: { attemptNo: true }
  });

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: Number(lastAttempt?.attemptNo || 0) + 1,
      status: "MANUAL_CHARGE_FAILED",
      errorCode: args.errorCode,
      errorMessage: args.errorCode,
      provider: "apiflujos",
      response: args.details ? (args.details as any) : undefined
    }
  });

  return payment.id;
}

export async function setSubscriptionRetryDate(args: {
  subscriptionId: string;
  nextRetryAt: string | null;
  tenantId?: string | null;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const nextRetryAt = args.nextRetryAt ? new Date(args.nextRetryAt) : null;
  const manualRetry = nextRetryAt
    ? { nextRetryAt: nextRetryAt.toISOString(), setAt: new Date().toISOString() }
    : null;

  const metadata = subscription.metadata && typeof subscription.metadata === "object" ? (subscription.metadata as any) : {};
  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      metadata: {
        ...metadata,
        manualRetry
      }
    }
  });

  // Sync retry jobs
  if (nextRetryAt) {
    await ensurePaymentRetryJob({ subscriptionId, runAt: nextRetryAt, maxAttempts: 1 }).catch(() => {});
  } else {
    await prisma.retryJob.deleteMany({
      where: {
        type: RetryJobType.PAYMENT_RETRY,
        status: RetryJobStatus.PENDING,
        payload: { path: ["subscriptionId"], equals: subscriptionId } as any
      } as any
    }).catch(() => {});
  }

  return { ok: true, subscription: updated };
}

export async function listSubscriptions(args: {
  tenantId?: string | null;
  take?: number;
  skip?: number;
  q?: string;
  customerId?: string;
  estado?: string;
  collectionMode?: string;
  ids?: string[];
}) {
  const tenantId = args.tenantId || null;
  const takeRaw = Number(args.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(args.q ?? "").trim();
  const customerId = String(args.customerId ?? "").trim();
  const estado = String(args.estado ?? "").trim();
  const collectionMode = String(args.collectionMode ?? "").trim();
  const ids = Array.isArray(args.ids) ? args.ids.map((v) => v.trim()).filter(Boolean) : [];

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

  if (ids.length) {
    where.AND = Array.isArray(where.AND) ? [...where.AND, { id: { in: ids } }] : [{ id: { in: ids } }];
  }

  const items = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { customer: true, plan: { include: { tenantLinks: true } }, tenantLinks: true }
  });
  const total = await prisma.subscription.count({ where });
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
    select: { id: true, subscriptionId: true, sentAt: true, checkoutUrl: true }
  });
  const lastLinkBySub = new Map<string, { id: string; sentAt: Date; checkoutUrl: string }>();
  for (const link of latestLinks) {
    if (!lastLinkBySub.has(link.subscriptionId)) lastLinkBySub.set(link.subscriptionId, link);
  }

  const pendingRetries = subscriptionIds.length
    ? await prisma.retryJob.findMany({
        where: {
          type: RetryJobType.PAYMENT_RETRY,
          status: RetryJobStatus.PENDING,
          OR: subscriptionIds.map((id) => ({ payload: { path: ["subscriptionId"], equals: id } as any }))
        }
      })
    : [];
  const nextRetryBySub = new Map<string, { runAt: Date }>();
  for (const job of pendingRetries) {
    const subId = String((job.payload as any)?.subscriptionId || "");
    if (!subId) continue;
    const current = nextRetryBySub.get(subId);
    if (!current || (job.runAt && current.runAt > job.runAt)) {
      nextRetryBySub.set(subId, { runAt: job.runAt });
    }
  }

  const autoDebitCfg = await getAutoDebitConfig();
  const mapped = items.map((s: any) => {
    const lastPayment = lastPaymentBySub.get(String(s.id)) || null;
    const lastLink = lastLinkBySub.get(String(s.id)) || null;
    const nextRetry = nextRetryBySub.get(String(s.id)) || null;
    const resolvedMode = resolveSubscriptionCollectionMode(s);
    const customerTokenized = hasUsablePaymentSource(s.customer?.metadata);
    const periodStartAt = s.currentPeriodStartAt ? new Date(s.currentPeriodStartAt) : null;
    const periodEndAt = s.currentPeriodEndAt ? new Date(s.currentPeriodEndAt) : null;
    const lastPaidAt = lastPayment?.paidAt ? new Date(lastPayment.paidAt) : null;
    const lastPaidInCurrentPeriod =
      Boolean(lastPaidAt && periodStartAt && periodEndAt) &&
      lastPaidAt!.getTime() >= periodStartAt!.getTime() &&
      lastPaidAt!.getTime() <= periodEndAt!.getTime();
    const dueByCutoff = periodEndAt;
    const dueAt = dueByCutoff;
    const chargeDue = dueAt ? dueAt.getTime() <= Date.now() + 5_000 : false;
    const isInactive =
      s.status === SubscriptionStatus.CANCELED || s.status === SubscriptionStatus.EXPIRED || s.status === SubscriptionStatus.SUSPENDED;
    const canManualCharge =
      Boolean(autoDebitCfg?.allowManualCharge ?? true) &&
      resolvedMode === "AUTO_DEBIT" &&
      chargeDue &&
      !isInactive &&
      customerTokenized &&
      !lastPaidInCurrentPeriod;

    return {
      ...s,
      tenantIds: Array.from(new Set([s.tenantId, ...(s.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[],
      lastPayment,
      lastPaymentLink: lastLink || null,
      nextRetryJob: nextRetry || null,
      collectionModeResolved: resolvedMode,
      customerTokenized,
      chargeDue,
      canManualCharge,
      lastPaidInCurrentPeriod
    };
  });

  return { items: mapped, total };
}

export async function createSubscription(args: {
  customerId: string;
  empresaId?: string | null;
  contactoId?: string | null;
  planId: string;
  tenantIds: string[];
  startAt?: string;
  firstPeriodEndAt?: string;
  createPaymentLink?: boolean;
  allowDuplicate?: boolean;
  metadata?: Record<string, any>;
}) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: args.planId }, include: { tenantLinks: true } });
  if (!plan) return { ok: false, status: 404, error: "plan_no_encontrado" as const };

  const customer = await prisma.customer.findUnique({ where: { id: args.customerId } });
  if (!customer) return { ok: false, status: 404, error: "customer_no_encontrado" as const };

  const planTenantIds = Array.from(new Set([plan.tenantId, ...(plan.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[];
  const effectiveTenantIds = Array.from(new Set((args.tenantIds || []).map((t) => String(t || "").trim()).filter(Boolean)));
  if (!effectiveTenantIds.length) return { ok: false, status: 400, error: "tenant_requerido" as const };

  if (planTenantIds.length) {
    const invalid = effectiveTenantIds.find((t) => !planTenantIds.includes(t));
    if (invalid) return { ok: false, status: 409, error: "tenant_no_permitido_para_plan" as const };
  }
  if (customer.tenantId && !effectiveTenantIds.includes(customer.tenantId)) return { ok: false, status: 409, error: "tenant_mismatch" as const };
  if (!customer.tenantId) {
    const linked = await prisma.customerTenant.findFirst({
      where: { customerId: customer.id, tenantId: { in: effectiveTenantIds } }
    });
    if (!linked) return { ok: false, status: 409, error: "tenant_mismatch" as const };
  }
  if (!args.allowDuplicate) {
    const catalogItemId = String((plan.metadata as any)?.catalog?.itemId || "").trim();
    const activeStatuses = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED, SubscriptionStatus.EXPIRED];
    const duplicateWhere: any = {
      customerId: args.customerId,
      status: { in: activeStatuses }
    };
    if (catalogItemId) {
      duplicateWhere.OR = [
        { planId: args.planId },
        { plan: { metadata: { path: ["catalog", "itemId"], equals: catalogItemId } as any } }
      ];
    } else {
      duplicateWhere.planId = args.planId;
    }
    const duplicatesCount = await prisma.subscription.count({ where: duplicateWhere });
    if (duplicatesCount > 0) return { ok: false, status: 409, error: "suscripcion_duplicada_requiere_aprobacion" as const };
  }
  const tenantId = effectiveTenantIds[0];

  const collectionMode = String((plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  const paymentSourceId = (() => {
    const meta = (customer.metadata as any) ?? {};
    const candidates = [meta?.wompi?.paymentSourceId, meta?.wompi?.payment_source_id, meta?.paymentSourceId, meta?.payment_source_id];
    for (const v of candidates) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    }
    return null;
  })();
  const hasPaymentSource = Number.isFinite(paymentSourceId as any);
  const startAt = args.startAt ? new Date(args.startAt) : new Date();
  const computedEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);
  const periodEnd = args.firstPeriodEndAt ? new Date(args.firstPeriodEndAt) : computedEnd;
  if (Number.isNaN(periodEnd.getTime())) return { ok: false, status: 400, error: "first_period_end_at_invalido" as const };
  if (periodEnd < startAt) return { ok: false, status: 400, error: "first_period_end_anterior_a_start" as const };

  const subscriptionMetaBase = args.metadata && typeof args.metadata === "object" ? (args.metadata as any) : {};

  const subscription = await prisma.subscription.create({
    data: {
      tenantId,
      customerId: args.customerId,
      empresaId: args.empresaId || null,
      contactoId: args.contactoId || null,
      planId: plan.id,
      status: SubscriptionStatus.PAST_DUE,
      startAt,
      currentPeriodStartAt: startAt,
      currentPeriodEndAt: periodEnd,
      currentCycle: 1,
      metadata: {
        ...subscriptionMetaBase,
        collectionMode
      } as any
    }
  });

  if (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK") {
    await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt: periodEnd, maxAttempts: 1 }).catch(() => {});
  }
  await prisma.subscriptionTenant.createMany({
    data: effectiveTenantIds.map((t) => ({ subscriptionId: subscription.id, tenantId: t })),
    skipDuplicates: true
  });
  await prisma.customerTenant
    .createMany({ data: effectiveTenantIds.map((t) => ({ customerId: customer.id, tenantId: t })), skipDuplicates: true })
    .catch(() => {});

  await consumeApp("subscriptions_created", {
    amount: 1,
    source: "admin:subscriptions.create",
    meta: { subscriptionId: subscription.id, planId: plan.id }
  });
  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});

  const runAt = periodEnd <= new Date(Date.now() + 5_000) ? new Date() : periodEnd;

  if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt, maxAttempts: 1 }).catch(() => {});
    const isDueNow = runAt.getTime() <= Date.now() + 5_000;
    const shouldCreateLinkNow = collectionMode === "AUTO_LINK" ? Boolean(args.createPaymentLink) && isDueNow : false;

    if (!shouldCreateLinkNow) {
      return { ok: true, subscription, scheduled: true };
    }

    try {
      const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
      return {
        ok: true,
        subscription,
        scheduled: true,
        ...link,
        paymentSourceMissing: collectionMode === "AUTO_DEBIT" && !hasPaymentSource
      };
    } catch (err: any) {
      await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
        subscriptionId: subscription.id,
        err: err?.message ? String(err.message) : "unknown error"
      }).catch(() => {});
      return { ok: true, subscription, scheduled: true, paymentLinkError: "fallo_creando_link_de_pago" };
    }
  }

  if (!args.createPaymentLink) return { ok: true, subscription };

  try {
    const link = await createPaymentLinkForSubscription({ subscriptionId: subscription.id });
    return { ok: true, subscription, ...link };
  } catch (err: any) {
    await systemLog(LogLevel.ERROR, "subscriptions.create", "Subscription created but payment link failed", {
      subscriptionId: subscription.id,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    return { ok: true, subscription, paymentLinkError: "fallo_creando_link_de_pago" };
  }
}

export async function createSubscriptionPaymentLink(args: { subscriptionId: string; tenantId?: string | null; amountInCents?: number }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_id" as const };
  if (args.tenantId) {
    const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
    if (!existing) return { ok: false, status: 404, error: "subscription_not_found" as const };
    const allowed =
      existing.tenantId === args.tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }
  try {
    const link = await createPaymentLinkForSubscription({
      subscriptionId,
      amountInCentsOverride: args.amountInCents
    });
    return { ok: true, ...link };
  } catch (err: any) {
    await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
      subscriptionId,
      err: err?.message ? String(err.message) : "unknown error"
    }).catch(() => {});
    return { ok: false, status: 502, error: "wompi_payment_link_failed" as const };
  }
}

export async function chargeSubscriptionNow(args: { subscriptionId: string; tenantId?: string | null; amountInCents?: number }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, customer: true, tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode !== "AUTO_DEBIT") {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "manual_charge_not_allowed",
      details: { collectionMode }
    }).catch(() => null);
    return { ok: false, status: 409, error: "manual_charge_not_allowed", ...(paymentId ? { paymentId } : {}) };
  }

  const autoDebitCfg = await getAutoDebitConfig();
  if (!autoDebitCfg.allowManualCharge) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "manual_charge_disabled_by_settings"
    }).catch(() => null);
    return { ok: false, status: 409, error: "manual_charge_disabled_by_settings", ...(paymentId ? { paymentId } : {}) };
  }

  const now = new Date();
  const latestApproved = await prisma.payment.findFirst({
    where: { subscriptionId, status: PaymentStatus.APPROVED },
    orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    select: { paidAt: true, updatedAt: true, createdAt: true }
  });
  const lastApprovedAt = latestApproved?.paidAt || latestApproved?.updatedAt || latestApproved?.createdAt || null;
  const lastApprovedAtDate = lastApprovedAt ? new Date(lastApprovedAt) : null;
  const periodStartAt = subscription.currentPeriodStartAt ? new Date(subscription.currentPeriodStartAt) : null;
  const periodEndAt = subscription.currentPeriodEndAt ? new Date(subscription.currentPeriodEndAt) : null;
  const approvedAt = lastApprovedAtDate;
  const lastPaidInCurrentPeriod =
    lastApprovedAtDate && periodStartAt && periodEndAt
      ? lastApprovedAtDate.getTime() >= periodStartAt.getTime() &&
        lastApprovedAtDate.getTime() <= periodEndAt.getTime()
      : false;
  if (lastPaidInCurrentPeriod) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "payment_already_approved",
      details: {
        paidAt: approvedAt ? approvedAt.toISOString() : null,
        currentPeriodStartAt: periodStartAt?.toISOString() || null,
        currentPeriodEndAt: periodEndAt?.toISOString() || null
      }
    }).catch(() => null);
    return { ok: false, status: 409, error: "payment_already_approved", ...(paymentId ? { paymentId } : {}) };
  }

  const recentPending = await prisma.payment.findFirst({
    where: {
      subscriptionId,
      status: PaymentStatus.PENDING,
      wompiTransactionId: { not: null },
      createdAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, wompiTransactionId: true, createdAt: true }
  });
  if (recentPending) {
    if (recentPending.wompiTransactionId && args.tenantId) {
      await reconcileWompiTransaction({
        wompiTransactionId: recentPending.wompiTransactionId,
        tenantId: args.tenantId,
        checksumPrefix: "manual-charge-precheck"
      }).catch(() => {});
      const refreshed = await prisma.payment.findUnique({
        where: { id: recentPending.id },
        select: { status: true }
      });
      if (!(refreshed && refreshed.status !== PaymentStatus.PENDING)) {
        const details = {
          paymentId: recentPending.id,
          wompiTransactionId: recentPending.wompiTransactionId,
          createdAt: recentPending.createdAt
        };
        const failedPaymentId = await recordManualChargeFailure({
          subscription,
          amountInCentsOverride: args.amountInCents,
          errorCode: "pending_charge_exists",
          details
        }).catch(() => null);
        return { ok: false, status: 409, error: "pending_charge_exists", details, paymentId: failedPaymentId || recentPending.id };
      }
    } else {
      const details = {
        paymentId: recentPending.id,
        wompiTransactionId: recentPending.wompiTransactionId,
        createdAt: recentPending.createdAt
      };
      const failedPaymentId = await recordManualChargeFailure({
        subscription,
        amountInCentsOverride: args.amountInCents,
        errorCode: "pending_charge_exists",
        details
      }).catch(() => null);
      return { ok: false, status: 409, error: "pending_charge_exists", details, paymentId: failedPaymentId || recentPending.id };
    }
  }

  const meta = (subscription.customer?.metadata as any) ?? {};
  const paymentSource =
    meta?.wompi?.paymentSourceId || meta?.wompi?.payment_source_id || meta?.paymentSourceId || meta?.payment_source_id;
  if (!paymentSource) {
    const details = { availableKeys: Object.keys(meta || {}), wompiKeys: Object.keys(meta?.wompi || {}) };
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "customer_payment_source_missing",
      details
    }).catch(() => null);
    return { ok: false, status: 409, error: "customer_payment_source_missing", details, ...(paymentId ? { paymentId } : {}) };
  }
  if (!subscription.customer?.email) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "customer_email_required"
    }).catch(() => null);
    return { ok: false, status: 409, error: "customer_email_required", ...(paymentId ? { paymentId } : {}) };
  }

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
      amountInCentsOverride: args.amountInCents,
      forceNewTransaction: true
    });
    return { ok: true, ...result, manualChargeAt };
  } catch (err: any) {
    const paymentId =
      (
        await prisma.payment
          .findUnique({
            where: { subscriptionCycleKey: `${subscription.id}:${Number(subscription.currentCycle || 1)}` },
            select: { id: true }
          })
          .catch(() => null)
      )?.id || null;
    return { ok: false, status: 502, error: err?.message || "charge_now_failed", ...(paymentId ? { paymentId } : {}) };
  }
}

export async function scheduleSubscriptionCutoff(args: { subscriptionId: string; cutoffAt: string; tenantId?: string | null }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  const cutoffAtRaw = String(args.cutoffAt || "").trim();
  if (!subscriptionId || !cutoffAtRaw) return { ok: false, status: 400, error: "invalid_cutoff_date" as const };

  const cutoffAt = new Date(cutoffAtRaw);
  if (Number.isNaN(cutoffAt.getTime())) return { ok: false, status: 400, error: "invalid_cutoff_date" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode !== "AUTO_DEBIT" && collectionMode !== "AUTO_LINK") {
    return { ok: false, status: 409, error: "schedule_cutoff_not_allowed" as const };
  }

  // Si la suscripción está al día, solo permitir mover el corte hacia el futuro.
  if (
    subscription.status === SubscriptionStatus.ACTIVE &&
    subscription.currentPeriodEndAt &&
    cutoffAt.getTime() < new Date(subscription.currentPeriodEndAt).getTime()
  ) {
    return { ok: false, status: 409, error: "cutoff_cannot_move_backwards" as const };
  }

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

  await ensurePaymentRetryJob({
    subscriptionId,
    runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
    maxAttempts: 1
  }).catch(() => {});

  // Si el corte ya está vencido y el cobro en corte está activo, intentamos cobrar inmediatamente.
  const autoDebitConfig = await getAutoDebitConfig();
  if (collectionMode === "AUTO_DEBIT" && autoDebitConfig.chargeAtCutoffEnabled && cutoffAt <= new Date(Date.now() + 5_000)) {
    await createAutoDebitTransactionForSubscription({
      subscriptionId,
      forceNewTransaction: true
    }).catch((err: any) => {
      const msg = String(err?.message || "");
      if (!msg.includes("payment_already_approved")) {
        systemLog(LogLevel.WARN, "subscriptions.cutoff", "Immediate cutoff charge failed", {
          subscriptionId,
          err: msg
        }).catch(() => {});
      }
    });
  }

  return { ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true };
}

export async function recalcSubscriptionCutoff(args: { subscriptionId: string; tenantId?: string | null }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: true,
      tenantLinks: true,
      payments: {
        where: { status: PaymentStatus.APPROVED },
        orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }
  if (!subscription.plan) return { ok: false, status: 409, error: "plan_not_found" as const };

  const baseStart = subscription.currentPeriodEndAt || subscription.currentPeriodStartAt || subscription.createdAt;
  const nextEnd = addIntervalUtc(baseStart, subscription.plan.intervalUnit, subscription.plan.intervalCount);

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      currentPeriodStartAt: baseStart,
      currentPeriodEndAt: nextEnd
    }
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: { path: ["subscriptionId"], equals: subscriptionId } as any
    } as any
  });

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({
      subscriptionId,
      runAt: nextEnd <= new Date(Date.now() + 5_000) ? new Date() : nextEnd,
      maxAttempts: 1
    }).catch(() => {});
  }

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});
  await systemLog(LogLevel.INFO, "subscriptions.recalculate_cutoff", "Subscription cutoff recalculated", {
    subscriptionId,
    startAt: (baseStart as any)?.toISOString?.() || baseStart,
    endAt: (nextEnd as any)?.toISOString?.() || nextEnd
  }).catch(() => {});

  return { ok: true, subscription: updated, startAt: baseStart, endAt: nextEnd };
}

export async function updateSubscriptionTenants(args: {
  subscriptionId: string;
  tenantId?: string | null;
  tenantIds: string[];
  primaryTenantId?: string | null;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "missing_subscription_id" as const };

  const existing = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tenantLinks: true }
  });
  if (!existing) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      existing.tenantId === args.tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
    const invalid = (args.tenantIds || []).find((t) => t !== args.tenantId);
    if (invalid) return { ok: false, status: 403, error: "tenant_forbidden" as const };
    if (args.primaryTenantId && args.primaryTenantId !== args.tenantId) return { ok: false, status: 403, error: "tenant_forbidden" as const };
  }

  const requestedTenantIds: string[] = Array.from(new Set((args.tenantIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
  const requestedPrimary = String(args.primaryTenantId || "").trim();
  if (requestedPrimary && !requestedTenantIds.includes(requestedPrimary)) return { ok: false, status: 400, error: "primary_tenant_not_in_list" as const };
  const primaryTenantId = requestedPrimary || requestedTenantIds[0] || undefined;

  if (requestedTenantIds.length) {
    const countTenants = await prisma.saTenant.count({ where: { id: { in: requestedTenantIds } } });
    if (countTenants !== requestedTenantIds.length) return { ok: false, status: 400, error: "tenant_not_found" as const };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.subscription.update({
      where: { id: subscriptionId },
      data: primaryTenantId ? { tenantId: primaryTenantId } : {}
    });
    await tx.subscriptionTenant.deleteMany({ where: { subscriptionId } });
    if (requestedTenantIds.length) {
      await tx.subscriptionTenant.createMany({
        data: requestedTenantIds.map((t) => ({ subscriptionId, tenantId: t })),
        skipDuplicates: true
      });
    }
    return next;
  });

  return { ok: true, subscription: updated };
}

export async function changeSubscriptionPlan(args: {
  subscriptionId: string;
  planId: string;
  cutoffAt: string;
  shippingInCents?: number;
  freeShipping?: boolean;
  tenantId?: string | null;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "missing_subscription_id" as const };
  const cutoffAtRaw = String(args.cutoffAt || "").trim();
  const cutoffAt = new Date(cutoffAtRaw);
  if (!cutoffAtRaw || Number.isNaN(cutoffAt.getTime())) return { ok: false, status: 400, error: "invalid_cutoff_date" as const };

  const [subscription, plan] = await Promise.all([
    prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true, plan: true } }),
    prisma.subscriptionPlan.findUnique({ where: { id: args.planId }, include: { tenantLinks: true } })
  ]);
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (!plan) return { ok: false, status: 404, error: "plan_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
    const allowedPlan = plan.tenantId === args.tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowedPlan) return { ok: false, status: 404, error: "plan_not_found" as const };
  }

  const planMeta = (plan.metadata as any) ?? {};
  const sourcePlanId = String(plan.id || "");
  const catalog = planMeta?.catalog ?? {};
  const pricing = readPlanPricing(planMeta);
  const kind = String(catalog?.kind || "").toUpperCase();
  const requiresShipping = kind !== "SERVICE";
  const defaultShippingInCents = Number(pricing?.shippingInCents || 0);
  const requestedShippingInCents = requiresShipping ? (args.freeShipping ? 0 : Number(args.shippingInCents ?? defaultShippingInCents)) : 0;

  if (requiresShipping && !args.freeShipping && requestedShippingInCents <= 0) {
    return { ok: false, status: 400, error: "missing_shipping_amount" as const };
  }

  const totals = computePlanTotalInCents({
    basePriceInCents: Number(pricing?.basePriceInCents || plan.priceInCents || 0),
    variantDeltaInCents: Number(catalog?.variantDeltaInCents || 0),
    shippingInCents: requestedShippingInCents,
    discountType: String(pricing?.discountType || "NONE"),
    discountValueInCents: Number(pricing?.discountValueInCents || 0),
    discountPercent: Number(pricing?.discountPercent || 0),
    taxPercent: Number(pricing?.taxPercent || 0)
  });

  const subscriptionMetaBase = subscription.metadata && typeof subscription.metadata === "object" ? (subscription.metadata as any) : {};
  const nextSubscriptionMetadata = {
    ...subscriptionMetaBase,
    collectionMode: String((plan.metadata as any)?.collectionMode || "MANUAL_LINK"),
    pricing: {
      ...(subscriptionMetaBase?.pricing && typeof subscriptionMetaBase.pricing === "object" ? subscriptionMetaBase.pricing : {}),
      sourcePlanId,
      basePriceInCents: Number(pricing?.basePriceInCents || plan.priceInCents || 0),
      variantDeltaInCents: Number(catalog?.variantDeltaInCents || 0),
      shippingInCents: requestedShippingInCents,
      subtotalInCents: totals.subtotalInCents,
      taxInCents: totals.taxInCents,
      totalInCents: totals.totalInCents,
      freeShipping: Boolean(args.freeShipping),
      currency: plan.currency,
      updatedAt: new Date().toISOString()
    }
  };

  const now = new Date();
  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      planId: plan.id,
      metadata: nextSubscriptionMetadata as any,
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

  const updatedMode = resolveSubscriptionCollectionMode({ metadata: nextSubscriptionMetadata, plan });
  if (updatedMode === "AUTO_LINK" || updatedMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({
      subscriptionId,
      runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
      maxAttempts: 1
    }).catch(() => {});
  }

  return { ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true };
}

export async function updateSubscriptionStatus(args: {
  subscriptionId: string;
  tenantId?: string | null;
  action: "suspend" | "cancel" | "resume" | "activate";
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!existing) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      existing.tenantId === args.tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  if (args.action === "suspend") {
    if (existing.status === SubscriptionStatus.CANCELED) return { ok: false, status: 409, error: "subscription_canceled" as const };
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.SUSPENDED, suspendedAt: new Date() }
    });
    await systemLog(LogLevel.INFO, "subscriptions.suspend", "Subscription suspended", { subscriptionId }).catch(() => {});
    return { ok: true, subscription: updated };
  }

  if (args.action === "cancel") {
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), suspendedAt: null }
    });
    await systemLog(LogLevel.INFO, "subscriptions.cancel", "Subscription canceled", { subscriptionId }).catch(() => {});
    return { ok: true, subscription: updated };
  }

  if (args.action === "resume") {
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE, suspendedAt: null }
    });
    await systemLog(LogLevel.INFO, "subscriptions.resume", "Subscription resumed", { subscriptionId }).catch(() => {});
    return { ok: true, subscription: updated };
  }

  if (args.action === "activate") {
    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE, canceledAt: null, suspendedAt: null }
    });
    await systemLog(LogLevel.INFO, "subscriptions.activate", "Subscription activated", { subscriptionId }).catch(() => {});
    return { ok: true, subscription: updated };
  }

  return { ok: false, status: 400, error: "unknown_action" as const };
}

export async function deleteSubscription(args: { subscriptionId: string; tenantId?: string | null; force?: boolean; purgePayments?: boolean }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const force = Boolean(args.force);
  if (!force && subscription.status !== SubscriptionStatus.CANCELED) {
    return { ok: false, status: 409, error: "subscription_must_be_canceled" as const };
  }

  const [paymentsCount, paymentLinksCount] = await Promise.all([
    prisma.payment.count({ where: { subscriptionId } }),
    prisma.paymentLink.count({ where: { subscriptionId } })
  ]);
  if (!force && (paymentsCount || paymentLinksCount)) {
    return { ok: false, status: 409, error: "subscription_has_dependencies" as const };
  }

  if (force) {
    const payments = await prisma.payment.findMany({ where: { subscriptionId }, select: { id: true } });
    const paymentIds = payments.map((p: any) => p.id);

    if (paymentIds.length) {
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
    }
    await prisma.chatwootMessage.deleteMany({ where: { subscriptionId } }).catch(() => {});
    await prisma.paymentLink.deleteMany({ where: { subscriptionId } }).catch(() => {});
    if (args.purgePayments) {
      await prisma.payment.deleteMany({ where: { subscriptionId } }).catch(() => {});
    }
    await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId } }).catch(() => {});
  }

  await prisma.subscription.delete({ where: { id: subscriptionId } });
  return { ok: true };
}

export async function mergeDuplicateSubscriptions(args: {
  customerId: string;
  planId?: string;
  keepSubscriptionId?: string;
  tenantId?: string | null;
}) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "missing_customer_id" as const };

  const where: any = { customerId };
  if (args.planId) where.planId = args.planId;
  const duplicates = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  if (duplicates.length <= 1) return { ok: false, status: 404, error: "no_duplicates_found" as const };

  let keepId = String(args.keepSubscriptionId || "").trim();
  if (keepId && !duplicates.some((s) => s.id === keepId)) {
    keepId = "";
  }
  if (!keepId) keepId = duplicates[0].id;

  const toMerge = duplicates.filter((s) => s.id !== keepId);
  for (const sub of toMerge) {
    const paymentsCount = await prisma.payment.count({ where: { subscriptionId: sub.id } });
    const linksCount = await prisma.paymentLink.count({ where: { subscriptionId: sub.id } });
    if (!paymentsCount && !linksCount) {
      await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
      await prisma.subscription.delete({ where: { id: sub.id } }).catch(() => {});
    } else {
      const meta = (sub.metadata && typeof sub.metadata === "object" ? (sub.metadata as any) : {}) as any;
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.CANCELED,
          canceledAt: sub.canceledAt || new Date(),
          metadata: { ...meta, mergedInto: keepId } as any
        }
      });
    }
  }

  return { ok: true, keepSubscriptionId: keepId, mergedCount: toMerge.length };
}
