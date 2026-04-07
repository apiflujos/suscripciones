import "server-only";

import { LogLevel, PaymentStatus } from "@prisma/client";
import { prisma } from "@suscripciones/database";
import { reconcileWompiTransaction } from "@suscripciones/core/services/wompiReconcile";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { logger } from "@suscripciones/core/lib/logger";
import { ensureBillingCyclesForSubscription } from "@suscripciones/core/services/billingCycles";

async function reconcilePendingPaymentFromWompi(args: { paymentId: string; wompiTransactionId?: string | null; tenantId?: string | null }) {
  const txId = String(args.wompiTransactionId || "").trim();
  if (!txId) return;

  try {
    await reconcileWompiTransaction({
      wompiTransactionId: txId,
      tenantId: args.tenantId || null,
      checksumPrefix: "poll-reconcile"
    });
    console.log("[PaymentReconcile] Success", { paymentId: args.paymentId, wompiTransactionId: txId });
  } catch (err: any) {
    console.error("[PaymentReconcile] Failed", {
      paymentId: args.paymentId,
      wompiTransactionId: txId,
      error: err?.message || String(err)
    });
    await systemLog(LogLevel.ERROR, "payments.reconcile", "Reconcile failed", {
      paymentId: args.paymentId,
      wompiTransactionId: txId,
      error: err?.message || String(err)
    }).catch((logErr: any) => {
      logger.warn({ err: logErr, paymentId: args.paymentId, wompiTransactionId: txId }, "Fallo escribiendo systemLog de reconcile fallido");
    });
  }
}

type PaymentStatusOk = {
  ok: true;
  payment: {
    id: string;
    status: string;
    paidAt: Date | null;
    failedAt: Date | null;
    wompiTransactionId: string | number | null;
  };
  lastAttempt: {
    id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    response: any;
    createdAt: Date;
  } | null;
};

type PaymentStatusFail = { ok: false; status: number; error: string };

export async function getPaymentStatus(args: { paymentId: string; tenantId?: string | null }): Promise<PaymentStatusOk | PaymentStatusFail> {
  const id = String(args.paymentId || "").trim();
  if (!id) return { ok: false, status: 400, error: "missing_payment_id" };

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      subscription: { include: { tenantLinks: true } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!payment) return { ok: false, status: 404, error: "payment_not_found" };

  if (args.tenantId) {
    const allowed =
      payment.tenantId === args.tenantId ||
      payment.subscription?.tenantId === args.tenantId ||
      (payment.subscription?.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "payment_not_found" };
  }

  if (
    payment.status === PaymentStatus.PENDING &&
    payment.wompiTransactionId &&
    payment.tenantId &&
    Date.now() - new Date(payment.createdAt).getTime() > 5_000
  ) {
    await reconcilePendingPaymentFromWompi({
      paymentId: payment.id,
      wompiTransactionId: payment.wompiTransactionId,
      tenantId: payment.tenantId
    }).catch((err: any) => {
      logger.warn({ err, paymentId: payment.id, wompiTransactionId: payment.wompiTransactionId }, "Fallo reconciliando pago pendiente desde polling");
    });

    const refreshed = await prisma.payment.findUnique({
      where: { id },
      include: {
        subscription: { include: { tenantLinks: true } },
        attempts: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });
    if (refreshed) {
      const lastAttempt = refreshed.attempts?.[0] || null;
      return {
        ok: true,
        payment: {
          id: refreshed.id,
          status: refreshed.status,
          paidAt: refreshed.paidAt,
          failedAt: refreshed.failedAt,
          wompiTransactionId: refreshed.wompiTransactionId
        },
        lastAttempt: lastAttempt
          ? {
              id: lastAttempt.id,
              status: lastAttempt.status,
              errorCode: lastAttempt.errorCode,
              errorMessage: lastAttempt.errorMessage,
              response: lastAttempt.response,
              createdAt: lastAttempt.createdAt
            }
          : null
      };
    }
  }

  const lastAttempt = payment.attempts?.[0] || null;
  return {
    ok: true,
    payment: {
      id: payment.id,
      status: payment.status,
      paidAt: payment.paidAt,
      failedAt: payment.failedAt,
      wompiTransactionId: payment.wompiTransactionId
    },
    lastAttempt: lastAttempt
      ? {
          id: lastAttempt.id,
          status: lastAttempt.status,
          errorCode: lastAttempt.errorCode,
          errorMessage: lastAttempt.errorMessage,
          response: lastAttempt.response,
          createdAt: lastAttempt.createdAt
        }
      : null
  };
}

export async function listSubscriptionBillingCycles(args: { subscriptionId: string; take?: number }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false as const, status: 400, error: "invalid_subscription_id" as const };
  const take = Math.min(36, Math.max(1, Number(args.take ?? 18)));
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: { select: { intervalUnit: true, intervalCount: true } } }
  });
  if (!subscription) return { ok: false as const, status: 404, error: "subscription_not_found" as const };

  await ensureBillingCyclesForSubscription({
    id: subscription.id,
    startAt: subscription.startAt,
    cycleStartDay: subscription.cycleStartDay,
    paymentDay: subscription.paymentDay,
    paymentTiming: subscription.paymentTiming as any,
    graceDays: subscription.graceDays,
    plan: {
      intervalUnit: subscription.plan.intervalUnit,
      intervalCount: subscription.plan.intervalCount
    }
  }).catch((err: any) => {
    logger.warn({ err, subscriptionId }, "Fallo asegurando ciclos antes de listar billing cycles");
  });

  const items = await prisma.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId,
      periodStartAt: { lte: new Date() }
    },
    orderBy: { periodStartAt: "desc" },
    take,
    include: { 
      subscription: { 
        select: { 
          id: true,
          plan: { select: { name: true, id: true } } 
        } 
      } 
    }
  });
  return { ok: true as const, items };
}

export async function searchSubscriptionPaymentCandidates(args: {
  subscriptionId: string;
  tenantId?: string | null;
  q: string;
  take?: number;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  const q = String(args.q || "").trim();
  if (!subscriptionId) return { ok: false as const, status: 400, error: "invalid_subscription_id" as const };
  if (!q) return { ok: true as const, items: [] };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tenantLinks: true }
  });
  if (!subscription) return { ok: false as const, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false as const, status: 404, error: "subscription_not_found" as const };
  }

  const take = Number.isFinite(args.take) ? Math.min(Math.max(Math.trunc(args.take!), 1), 50) : 20;
  const digits = q.replace(/\D+/g, "");
  const amountCandidates = digits ? Array.from(new Set([Number(digits), Number(digits) * 100].filter((n) => Number.isFinite(n)))) : [];

  const items = await prisma.payment.findMany({
    where: {
      customerId: subscription.customerId,
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      status: PaymentStatus.APPROVED,
      OR: [
        { subscriptionId: null },
        { subscriptionId, billingCycle: { is: null } }
      ],
      AND: [
        {
          OR: [
            { wompiTransactionId: { contains: q, mode: "insensitive" } },
            { reference: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customer: { email: { contains: q, mode: "insensitive" } } },
            ...(amountCandidates.length ? amountCandidates.map((amount) => ({ amountInCents: amount })) : [])
          ]
        }
      ]
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take
  });

  return {
    ok: true as const,
    items: items.map((p: any) => ({
      id: p.id,
      status: p.status,
      amountInCents: p.amountInCents,
      currency: p.currency,
      paidAt: p.paidAt,
      failedAt: p.failedAt,
      createdAt: p.createdAt,
      wompiTransactionId: p.wompiTransactionId,
      reference: p.reference,
      origin: p.origin || null,
      associationReason: p.associationReason || null,
      associatedBy: p.associatedBy || null
    }))
  };
}

export async function listCustomerBillingCycles(args: { customerId: string; take?: number }) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false as const, status: 400, error: "invalid_customer_id" as const };
  const take = Math.min(60, Math.max(1, Number(args.take ?? 24)));
  const items = await prisma.subscriptionBillingCycle.findMany({
    where: { subscription: { customerId } },
    orderBy: { periodStartAt: "desc" },
    take,
    include: { subscription: { select: { id: true, plan: { select: { name: true } } } } }
  });
  return { ok: true as const, items };
}

export async function getProductPayments(args: { productId: string; tenantId?: string | null; take: number; skip: number }) {
  const id = String(args.productId || "").trim();
  if (!id) return { ok: false, status: 400, error: "invalid_id" as const };

  if (args.tenantId) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
    if (!plan) return { ok: false, status: 404, error: "not_found" as const };
    const allowed = plan.tenantId === args.tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "not_found" as const };
  }

  const take = Number.isFinite(args.take) ? Math.min(Math.max(Math.trunc(args.take), 1), 200) : 50;
  const skip = Number.isFinite(args.skip) ? Math.max(Math.trunc(args.skip), 0) : 0;

  const payments = await prisma.payment.findMany({
    where: { subscription: { planId: id } },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { customer: true, subscription: { include: { plan: true } } }
  });

  return {
    ok: true,
    items: payments.map((p: any) => ({
      id: p.id,
      amountInCents: p.amountInCents,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      reference: p.reference,
      customerId: p.customerId,
      customerName: p.customer?.name || p.customer?.email || null,
      planName: p.subscription?.plan?.name || null
    }))
  };
}

export async function getCustomerPayments(args: { customerId: string; tenantId?: string | null; take: number; skip: number }) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "invalid_id" as const };

  const take = Number.isFinite(args.take) ? Math.min(Math.max(Math.trunc(args.take), 1), 200) : 50;
  const skip = Number.isFinite(args.skip) ? Math.max(Math.trunc(args.skip), 0) : 0;

  const items = await prisma.payment.findMany({
    where: { customerId, ...(args.tenantId ? { tenantId: args.tenantId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: {
      subscription: { include: { plan: true } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  return {
    ok: true,
    items: items.map((p: any) => ({
      id: p.id,
      amountInCents: p.amountInCents,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      reference: p.reference,
      origin: p.origin || null,
      associationReason: p.associationReason || null,
      associatedBy: p.associatedBy || null,
      planId: p.subscription?.planId || null,
      planName: p.subscription?.plan?.name || null,
      lastAttempt: p.attempts?.[0]
        ? {
            status: p.attempts[0].status,
            errorMessage: p.attempts[0].errorMessage,
            provider: p.attempts[0].provider,
            createdAt: p.attempts[0].createdAt
          }
        : null
    }))
  };
}

export async function getSubscriptionPaymentHistory(args: {
  subscriptionId: string;
  tenantId?: string | null;
  take: number;
  page: number;
  status?: string;
}) {
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

  const take = Number.isFinite(args.take) ? Math.min(Math.max(Math.trunc(args.take), 1), 50) : 20;
  const page = Number.isFinite(args.page) ? Math.max(Math.trunc(args.page), 1) : 1;
  const statusRaw = String(args.status || "").trim().toUpperCase();
  const statusFilter =
    statusRaw === "APPROVED" || statusRaw === "PENDING" || statusRaw === "DECLINED" || statusRaw === "ERROR" || statusRaw === "VOIDED"
      ? statusRaw
      : "";
  const where: any = { subscriptionId };
  if (statusFilter) where.status = statusFilter;
  const skip = (page - 1) * take;

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { failedAt: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        attempts: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    })
  ]);

  return {
    ok: true,
    total,
    page,
    take,
    items: payments.map((p: any) => ({
      id: p.id,
      status: p.status,
      amountInCents: p.amountInCents,
      currency: p.currency,
      paidAt: p.paidAt,
      failedAt: p.failedAt,
      createdAt: p.createdAt,
      wompiTransactionId: p.wompiTransactionId,
      reference: p.reference,
      origin: p.origin || null,
      associationReason: p.associationReason || null,
      associatedBy: p.associatedBy || null,
      attempts: (p.attempts || []).map((a: any) => ({
        id: a.id,
        status: a.status,
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        createdAt: a.createdAt
      }))
    }))
  };
}
