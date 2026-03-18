import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPublicKey } from "../services/runtimeConfig";
import { RetryJobType, WebhookProvider, WebhookProcessStatus, PaymentStatus } from "@prisma/client";
import { randomUUID } from "crypto";

const FINAL_STATUSES = new Set(["APPROVED", "DECLINED", "VOIDED", "ERROR"]);

function normalizeStatus(raw?: string | null) {
  return String(raw || "").trim().toUpperCase();
}

async function main() {
  const limit = Number(process.env.RECONCILE_LIMIT || 200);
  const olderMinutes = Number(process.env.RECONCILE_OLDER_MINUTES || 10);
  const tenantId = String(process.env.RECONCILE_TENANT_ID || "").trim() || undefined;

  const publicKey = await getWompiPublicKey();
  if (!publicKey) throw new Error("wompi_public_key_not_configured");

  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl });

  const cutoff = new Date(Date.now() - Math.max(1, olderMinutes) * 60_000);

  const pending = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.PENDING,
      wompiTransactionId: { not: null },
      createdAt: { lte: cutoff },
      ...(tenantId ? { tenantId } : {})
    },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      wompiTransactionId: true,
      wompiPaymentLinkId: true,
      amountInCents: true,
      currency: true,
      reference: true,
      createdAt: true,
      customer: { select: { email: true } }
    },
    orderBy: { createdAt: "asc" },
    take: Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.trunc(limit))) : 200
  });

  if (pending.length === 0) {
    console.log("No pending payments with transactionId to reconcile.");
    return;
  }

  let inspected = 0;
  let enqueued = 0;
  let skipped = 0;

  for (const payment of pending) {
    const txId = payment.wompiTransactionId;
    if (!txId) continue;

    try {
      inspected += 1;
      const tx = await wompi.getTransaction(txId, publicKey);
      const status = normalizeStatus(tx.status);
      if (!status || !FINAL_STATUSES.has(status)) {
        skipped += 1;
        continue;
      }

      const payload = {
        event: "transaction.updated",
        data: {
          transaction: {
            id: tx.id,
            status: tx.status,
            amount_in_cents: tx.amountInCents ?? payment.amountInCents,
            currency: tx.currency ?? payment.currency,
            reference: tx.reference ?? payment.reference,
            payment_link_id: tx.paymentLinkId ?? payment.wompiPaymentLinkId ?? undefined,
            customer_email: tx.customerEmail ?? payment.customer?.email ?? undefined
          }
        }
      };

      const event = await prisma.webhookEvent.create({
        data: {
          tenantId: payment.tenantId,
          provider: WebhookProvider.WOMPI,
          checksum: `reconcile:${tx.id}:${randomUUID()}`,
          eventName: "transaction.updated",
          payload: payload as any,
          processStatus: WebhookProcessStatus.RECEIVED,
          receivedAt: new Date()
        }
      });

      await prisma.retryJob.create({
        data: {
          type: RetryJobType.PROCESS_WOMPI_EVENT,
          payload: { webhookEventId: event.id }
        }
      });

      enqueued += 1;
    } catch (err: any) {
      skipped += 1;
      console.warn(`Reconcile failed for payment ${payment.id}:`, err?.message || err);
    }
  }

  console.log(`Reconcile done. Inspected: ${inspected}. Enqueued: ${enqueued}. Skipped: ${skipped}.`);
}

main()
  .catch((err) => {
    console.error("Reconcile failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
