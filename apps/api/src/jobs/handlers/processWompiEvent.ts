import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { ChatwootMessageType, PaymentStatus, RetryJobType, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { addIntervalUtc } from "../../lib/dates";

function getTransactionFromPayload(payload: any): any | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? tx : null;
}

export async function processWompiEvent(webhookEventId: string, env: { shopifyForwardUrl?: string; shopifyForwardSecret?: string }) {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;
  if (event.processStatus === WebhookProcessStatus.PROCESSED) return;

  const payload: any = event.payload;
  const tx = getTransactionFromPayload(payload);
  const reference: string | undefined = tx?.reference;
  const transactionId: string | undefined = tx?.id;
  const paymentLinkId: string | undefined = tx?.payment_link_id ?? tx?.paymentLinkId;
  const status: string | undefined = tx?.status;
  const amountInCents: number | undefined = tx?.amount_in_cents ?? tx?.amountInCents;
  const currency: string | undefined = tx?.currency;

  // Prefer mapping by payment_link_id (subscriptions created via API payment links)
  const paymentByLink = paymentLinkId
    ? await prisma.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } })
    : null;
  const referenceClassification = classifyReference(reference);

  if (paymentByLink?.subscriptionId) {
    // Subscription payment; process below using subscriptionId from Payment.
  } else if (referenceClassification.kind === "shopify" && env.shopifyForwardUrl) {
    await prisma.retryJob.create({
      data: {
        type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
        payload: { webhookEventId }
      }
    });
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.SKIPPED, processedAt: new Date() }
    });
    return;
  }

  if (!paymentByLink?.subscriptionId && referenceClassification.kind !== "subscription") {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.SKIPPED, processedAt: new Date() }
    });
    return;
  }

  const subscriptionId =
    paymentByLink?.subscriptionId ??
    (referenceClassification.kind === "subscription" ? referenceClassification.subscriptionId : "");

  // Registrar pago y, si está aprobado, renovar ciclo.
  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "subscription not found", processedAt: new Date() }
    });
    return;
  }

  const paymentStatus =
    status === "APPROVED" ? PaymentStatus.APPROVED : status === "DECLINED" ? PaymentStatus.DECLINED : PaymentStatus.ERROR;

  const cycleFromRef = referenceClassification.kind === "subscription" ? referenceClassification.cycle ?? null : null;
  const cycle = paymentByLink?.cycleNumber ?? cycleFromRef ?? subscription.currentCycle;
  const subscriptionCycleKey = `${subscription.id}:${cycle}`;
  const wasApproved =
    transactionId != null
      ? (await prisma.payment.findUnique({ where: { wompiTransactionId: transactionId } }))?.status === PaymentStatus.APPROVED
      : false;

  const now = new Date();
  const paidAt = paymentStatus === PaymentStatus.APPROVED ? now : null;

  const paymentRecord = paymentByLink
    ? await prisma.payment.update({
        where: { id: paymentByLink.id },
        data: {
          wompiTransactionId: transactionId,
          status: paymentStatus,
          paidAt,
          providerResponse: payload as any,
          amountInCents: amountInCents ?? paymentByLink.amountInCents,
          currency: currency ?? paymentByLink.currency,
          reference: reference ?? paymentByLink.reference,
          cycleNumber: paymentByLink.cycleNumber ?? cycle,
          subscriptionCycleKey
        }
      })
    : await prisma.payment.upsert({
        where: { subscriptionCycleKey },
        create: {
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          amountInCents: amountInCents ?? 0,
          currency: currency ?? "COP",
          cycleNumber: cycle,
          reference: reference ?? `SUB_${subscription.id}_${cycle}`,
          wompiTransactionId: transactionId,
          wompiPaymentLinkId: paymentLinkId,
          status: paymentStatus,
          paidAt,
          providerResponse: payload as any,
          subscriptionCycleKey
        },
        update: {
          wompiTransactionId: transactionId,
          status: paymentStatus,
          paidAt,
          providerResponse: payload as any,
          reference: reference ?? undefined,
          wompiPaymentLinkId: paymentLinkId ?? undefined
        }
      });

  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processStatus: WebhookProcessStatus.PROCESSED, processedAt: new Date() }
  });

  if (!wasApproved && paymentStatus === PaymentStatus.APPROVED) {
    const advancedTo = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id: subscription.id },
        include: { plan: true }
      });
      if (!sub) return null;

      if (sub.currentCycle !== cycle) {
        logger.warn({ subscriptionId: sub.id, currentCycle: sub.currentCycle, paymentCycle: cycle }, "Cycle mismatch; not advancing");
        return null;
      }

      const nextStart = sub.currentPeriodEndAt;
      const nextEnd = addIntervalUtc(nextStart, sub.plan.intervalUnit, sub.plan.intervalCount);

      const updated = await tx.subscription.updateMany({
        where: { id: sub.id, currentCycle: sub.currentCycle },
        data: {
          status: SubscriptionStatus.ACTIVE,
          retryCount: 0,
          currentCycle: { increment: 1 },
          currentPeriodStartAt: nextStart,
          currentPeriodEndAt: nextEnd
        }
      });

      if (updated.count === 0) {
        logger.warn({ subscriptionId: sub.id }, "Subscription already advanced (idempotent)");
        return null;
      } else {
        logger.info({ subscriptionId: sub.id, nextEnd }, "Subscription advanced after payment approval");
        return nextEnd;
      }
    });

    // Chatwoot: confirmación (best-effort async)
    if (advancedTo) {
      await prisma.chatwootMessage
        .create({
          data: {
            customerId: subscription.customerId,
            subscriptionId: subscription.id,
            paymentId: paymentRecord.id,
            type: ChatwootMessageType.PAYMENT_CONFIRMED,
            content: `Pago aprobado. Suscripción renovada hasta ${advancedTo.toISOString()}.`
          }
        })
        .then((msg) =>
          prisma.retryJob.create({
            data: { type: RetryJobType.SEND_CHATWOOT_MESSAGE, payload: { chatwootMessageId: msg.id } }
          })
        )
        .catch(() => {});
    }
  }
}

export async function forwardWompiToShopify(webhookEventId: string, env: { shopifyForwardUrl?: string; shopifyForwardSecret?: string }) {
  if (!env.shopifyForwardUrl) return;

  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;

  const res = await postJson(env.shopifyForwardUrl, event.payload, {
    "x-forwarded-by": "wompi-subs-api",
    ...(env.shopifyForwardSecret ? { "x-forwarded-secret": env.shopifyForwardSecret } : {})
  });

  if (!res.ok) {
    throw new Error(`forward failed: ${res.status} ${res.text}`);
  }
}
