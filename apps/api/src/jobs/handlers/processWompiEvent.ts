import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { ChatwootMessageType, PaymentStatus, RetryJobType, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { addIntervalUtc } from "../../lib/dates";
import { getShopifyForward } from "../../services/runtimeConfig";

function getTransactionFromPayload(payload: any): any | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? tx : null;
}

export async function processWompiEvent(webhookEventId: string) {
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

  // If we don't recognize the payment by link, and it's not a subscription reference, ignore.
  if (!paymentByLink && referenceClassification.kind !== "subscription") {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.SKIPPED, processedAt: new Date() }
    });
    return;
  }

  const subscriptionId =
    paymentByLink?.subscriptionId ??
    (referenceClassification.kind === "subscription" ? referenceClassification.subscriptionId : "");

  const isSubscription = !!subscriptionId;
  // Registrar pago y, si está aprobado, renovar ciclo (solo para suscripciones).
  const subscription = isSubscription ? await prisma.subscription.findUnique({ where: { id: subscriptionId } }) : null;
  if (isSubscription && !subscription) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "subscription not found", processedAt: new Date() }
    });
    return;
  }

  const paymentStatus =
    status === "APPROVED" ? PaymentStatus.APPROVED : status === "DECLINED" ? PaymentStatus.DECLINED : PaymentStatus.ERROR;

  const cycleFromRef = referenceClassification.kind === "subscription" ? referenceClassification.cycle ?? null : null;
  const cycle = paymentByLink?.cycleNumber ?? cycleFromRef ?? (subscription?.currentCycle ?? 1);
  const subscriptionCycleKey = subscription ? `${subscription.id}:${cycle}` : null;
  const wasApproved =
    transactionId != null
      ? (await prisma.payment.findUnique({ where: { wompiTransactionId: transactionId } }))?.status === PaymentStatus.APPROVED
      : false;

  const now = new Date();
  const paidAt = paymentStatus === PaymentStatus.APPROVED ? now : null;

  if (!paymentByLink && !subscription) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "payment not linked to subscription", processedAt: new Date() }
    });
    return;
  }

  const paymentRecord = paymentByLink
    ? await prisma.payment.update({
        where: { id: paymentByLink.id },
        data: {
          wompiTransactionId: transactionId,
          status: paymentStatus,
          paidAt,
          providerResponse:
            paymentByLink.providerResponse && typeof paymentByLink.providerResponse === "object"
              ? ({ ...(paymentByLink.providerResponse as any), webhook: payload } as any)
              : ({ webhook: payload } as any),
          amountInCents: amountInCents ?? paymentByLink.amountInCents,
          currency: currency ?? paymentByLink.currency,
          reference: reference ?? paymentByLink.reference,
          cycleNumber: paymentByLink.cycleNumber ?? cycle,
          subscriptionCycleKey: paymentByLink.subscriptionId ? subscriptionCycleKey : paymentByLink.subscriptionCycleKey
        }
      })
    : await prisma.payment.upsert({
        where: { subscriptionCycleKey: subscriptionCycleKey as string },
        create: {
          customerId: subscription!.customerId,
          subscriptionId: subscription!.id,
          amountInCents: amountInCents ?? 0,
          currency: currency ?? "COP",
          cycleNumber: cycle,
          reference: reference ?? `SUB_${subscription!.id}_${cycle}`,
          wompiTransactionId: transactionId,
          wompiPaymentLinkId: paymentLinkId,
          status: paymentStatus,
          paidAt,
          providerResponse: { webhook: payload } as any,
          subscriptionCycleKey: subscriptionCycleKey as string
        },
        update: {
          wompiTransactionId: transactionId,
          status: paymentStatus,
          paidAt,
          providerResponse: { webhook: payload } as any,
          reference: reference ?? undefined,
          wompiPaymentLinkId: paymentLinkId ?? undefined
        }
      });

  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processStatus: WebhookProcessStatus.PROCESSED, processedAt: new Date() }
  });

  if (!wasApproved && paymentStatus === PaymentStatus.APPROVED && subscription) {
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
        const collectionMode = (sub.plan.metadata as any)?.collectionMode;
        if (collectionMode === "AUTO_LINK") {
          await tx.retryJob
            .create({
              data: {
                type: RetryJobType.PAYMENT_RETRY,
                payload: { subscriptionId: sub.id }
              }
            })
            .catch(() => {});
        } else if (collectionMode === "AUTO_DEBIT") {
          await tx.retryJob
            .create({
              data: {
                type: RetryJobType.PAYMENT_RETRY,
                runAt: nextEnd,
                payload: { subscriptionId: sub.id }
              }
            })
            .catch(() => {});
        }
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

  // One-off order payments (no subscription): notify on approval (best-effort).
  if (!wasApproved && paymentStatus === PaymentStatus.APPROVED && !subscription) {
    await prisma.chatwootMessage
      .create({
        data: {
          customerId: paymentRecord.customerId,
          subscriptionId: null,
          paymentId: paymentRecord.id,
          type: ChatwootMessageType.PAYMENT_CONFIRMED,
          content: `Pago aprobado. Referencia: ${paymentRecord.reference}.`
        }
      })
      .then((msg) => prisma.retryJob.create({ data: { type: RetryJobType.SEND_CHATWOOT_MESSAGE, payload: { chatwootMessageId: msg.id } } }))
      .catch(() => {});
  }
}

export async function forwardWompiToShopify(webhookEventId: string) {
  const cfg = await getShopifyForward();
  if (!cfg.url) return;

  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;

  const res = await postJson(cfg.url, event.payload, {
    "x-forwarded-by": "wompi-subs-api",
    ...(cfg.secret ? { "x-forwarded-secret": cfg.secret } : {})
  });

  if (!res.ok) {
    throw new Error(`forward failed: ${res.status} ${res.text}`);
  }
}
