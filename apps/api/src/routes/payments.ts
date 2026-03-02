import express from "express";
import { prisma } from "../db/prisma";
import { getEffectiveTenantId } from "../services/tenantContext";
import { PaymentStatus, RetryJobType, WebhookProcessStatus, WebhookProvider } from "@prisma/client";
import { WompiClient } from "../providers/wompi/client";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPublicKey } from "../services/runtimeConfig";
import { randomUUID } from "crypto";
import { processWompiEventLogic } from "../jobs/handlers/processWompiEvent";

export const paymentsRouter = express.Router();

const FINAL_WOMPI_STATUSES = new Set(["APPROVED", "DECLINED", "VOIDED", "ERROR"]);

function normalizeStatus(raw?: string | null) {
  return String(raw || "").trim().toUpperCase();
}

async function reconcilePendingPaymentFromWompi(args: { paymentId: string; wompiTransactionId?: string | null; tenantId?: string | null }) {
  const txId = String(args.wompiTransactionId || "").trim();
  if (!txId) return;

  const publicKey = await getWompiPublicKey();
  if (!publicKey) return;
  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl });
  const tx = await wompi.getTransaction(txId, publicKey);
  const status = normalizeStatus(tx.status);
  if (!FINAL_WOMPI_STATUSES.has(status)) return;

  const payload = {
    event: "transaction.updated",
    data: {
      transaction: {
        id: tx.id,
        status: tx.status,
        amount_in_cents: tx.amountInCents,
        currency: tx.currency,
        reference: tx.reference,
        payment_link_id: tx.paymentLinkId,
        customer_email: tx.customerEmail
      }
    }
  };

  const event = await prisma.webhookEvent.create({
    data: {
      tenantId: String(args.tenantId || ""),
      provider: WebhookProvider.WOMPI,
      checksum: `poll-reconcile:${tx.id}:${randomUUID()}`,
      eventName: "transaction.updated",
      payload: payload as any,
      processStatus: WebhookProcessStatus.RECEIVED,
      receivedAt: new Date()
    }
  });

  // Process immediately so UI can see final status without waiting for background worker.
  await processWompiEventLogic(event.id, prisma).catch(async () => {
    await prisma.retryJob
      .create({
        data: {
          type: RetryJobType.PROCESS_WOMPI_EVENT,
          payload: { webhookEventId: event.id }
        }
      })
      .catch(() => {});
  });
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
          createdAt: lastAttempt.createdAt
        }
      : null
  });
});
