import express from "express";
import { prisma } from "../db/prisma";
import { getEffectiveTenantId } from "../services/tenantContext";
import { PaymentStatus } from "@prisma/client";
import { reconcileWompiTransaction } from "../services/wompiReconcile";
import { systemLog } from "../services/systemLog";
import { LogLevel } from "@prisma/client";

export const paymentsRouter = express.Router();

paymentsRouter.get("/subscription/:id/history", async (req, res) => {
  const subscriptionId = String(req.params.id || "").trim();
  if (!subscriptionId) return res.status(400).json({ error: "invalid_subscription_id" });

  const tenantId = await getEffectiveTenantId(req);
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { tenantLinks: true }
  });
  if (!subscription) return res.status(404).json({ error: "subscription_not_found" });

  if (tenantId) {
    const allowed =
      subscription.tenantId === tenantId ||
      (subscription.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "subscription_not_found" });
  }

  const takeRaw = Number(req.query?.take || 20);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 50) : 20;
  const pageRaw = Number(req.query?.page || 1);
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1;
  const statusRaw = String(req.query?.status || "").trim().toUpperCase();
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
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      include: {
        attempts: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    })
  ]);

  res.json({
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
      attempts: (p.attempts || []).map((a: any) => ({
        id: a.id,
        status: a.status,
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        createdAt: a.createdAt
      }))
    }))
  });
});

async function reconcilePendingPaymentFromWompi(args: { paymentId: string; wompiTransactionId?: string | null; tenantId?: string | null }) {
  const txId = String(args.wompiTransactionId || "").trim();
  if (!txId) return;
  
  try {
    await reconcileWompiTransaction({
      wompiTransactionId: txId,
      tenantId: args.tenantId || null,
      checksumPrefix: "poll-reconcile"
    });
    console.log('[PaymentReconcile] Success', { paymentId: args.paymentId, wompiTransactionId: txId });
  } catch (err: any) {
    console.error('[PaymentReconcile] Failed', {
      paymentId: args.paymentId,
      wompiTransactionId: txId,
      error: err?.message || String(err)
    });
    await systemLog(LogLevel.ERROR, 'payments.reconcile', 'Reconcile failed', {
      paymentId: args.paymentId,
      wompiTransactionId: txId,
      error: err?.message || String(err)
    }).catch(() => {});
  }
}

paymentsRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing_payment_id" });

  const tenantId = await getEffectiveTenantId(req);
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      subscription: { include: { tenantLinks: true } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!payment) return res.status(404).json({ error: "payment_not_found" });

  if (tenantId) {
    const allowed =
      payment.tenantId === tenantId ||
      payment.subscription?.tenantId === tenantId ||
      (payment.subscription?.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "payment_not_found" });
  }

  // Fallback reconcile: if webhook is delayed/lost, fetch Wompi tx status and process it.
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
    }).catch(() => {});

    const refreshed = await prisma.payment.findUnique({
      where: { id },
      include: {
        subscription: { include: { tenantLinks: true } },
        attempts: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });
    if (refreshed) {
      const lastAttempt = refreshed.attempts?.[0] || null;
      return res.json({
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
      });
    }
  }

  const lastAttempt = payment.attempts?.[0] || null;
  res.json({
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
  });
});
