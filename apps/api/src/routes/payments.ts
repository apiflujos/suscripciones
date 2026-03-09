import express from "express";
import { prisma } from "../db/prisma";
import { getEffectiveTenantId } from "../services/tenantContext";
import { PaymentStatus } from "@prisma/client";
import { reconcileWompiTransaction } from "../services/wompiReconcile";
import { systemLog } from "../services/systemLog";
import { LogLevel } from "@prisma/client";

export const paymentsRouter = express.Router();

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
