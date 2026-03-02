import { prisma } from "../db/prisma";
import { WompiClient } from "../providers/wompi/client";
import { getWompiApiBaseUrl, getWompiCheckoutLinkBaseUrl, getWompiPublicKey } from "../services/runtimeConfig";
import { RetryJobType, WebhookProvider, WebhookProcessStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { processWompiEventLogic } from "../jobs/handlers/processWompiEvent";

const FINAL_WOMPI_STATUSES = new Set(["APPROVED", "DECLINED", "VOIDED", "ERROR"]);

function normalizeStatus(raw?: string | null) {
  return String(raw || "").trim().toUpperCase();
}

export async function reconcileWompiTransaction(args: {
  wompiTransactionId: string;
  tenantId?: string | null;
  processNow?: boolean;
  checksumPrefix?: string;
}) {
  const txId = String(args.wompiTransactionId || "").trim();
  if (!txId) {
    return { ok: false, reason: "missing_transaction_id" as const };
  }

  const tenantId = String(args.tenantId || "").trim();
  if (!tenantId) {
    return { ok: false, reason: "missing_tenant" as const };
  }

  const publicKey = await getWompiPublicKey();
  if (!publicKey) {
    return { ok: false, reason: "wompi_public_key_not_configured" as const };
  }
  const apiBaseUrl = await getWompiApiBaseUrl();
  const checkoutLinkBaseUrl = await getWompiCheckoutLinkBaseUrl();
  const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl });
  const tx = await wompi.getTransaction(txId, publicKey);
  const status = normalizeStatus(tx.status);
  if (!FINAL_WOMPI_STATUSES.has(status)) {
    return { ok: false, reason: "status_not_final" as const, status };
  }

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

  const checksumPrefix = String(args.checksumPrefix || "reconcile").trim() || "reconcile";
  const event = await prisma.webhookEvent.create({
    data: {
      tenantId,
      provider: WebhookProvider.WOMPI,
      checksum: `${checksumPrefix}:${tx.id}:${randomUUID()}`,
      eventName: "transaction.updated",
      payload: payload as any,
      processStatus: WebhookProcessStatus.RECEIVED,
      receivedAt: new Date()
    }
  });

  const processNow = args.processNow !== false;
  if (processNow) {
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
  } else {
    await prisma.retryJob
      .create({
        data: {
          type: RetryJobType.PROCESS_WOMPI_EVENT,
          payload: { webhookEventId: event.id }
        }
      })
      .catch(() => {});
  }

  return { ok: true, webhookEventId: event.id, status: tx.status, reference: tx.reference };
}
