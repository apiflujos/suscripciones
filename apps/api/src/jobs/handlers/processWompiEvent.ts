import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { PaymentStatus, RetryJobType, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
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
  const status: string | undefined = tx?.status;
  const amountInCents: number | undefined = tx?.amount_in_cents ?? tx?.amountInCents;
  const currency: string | undefined = tx?.currency;

  const classification = classifyReference(reference);

  if (classification.kind === "shopify" && env.shopifyForwardUrl) {
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

  if (classification.kind !== "subscription") {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.SKIPPED, processedAt: new Date() }
    });
    return;
  }

  // Base: registrar pago y, si está aprobado, marcar como pagado.
  const subscription = await prisma.subscription.findUnique({ where: { id: classification.subscriptionId } });
  if (!subscription) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "subscription not found", processedAt: new Date() }
    });
    return;
  }

  const paymentStatus =
    status === "APPROVED" ? PaymentStatus.APPROVED : status === "DECLINED" ? PaymentStatus.DECLINED : PaymentStatus.ERROR;

  const cycleFromRef = classification.cycle ?? null;
  const subscriptionCycleKey = cycleFromRef != null ? `${subscription.id}:${cycleFromRef}` : null;
  const wasApproved =
    transactionId != null
      ? (await prisma.payment.findUnique({ where: { wompiTransactionId: transactionId } }))?.status === PaymentStatus.APPROVED
      : false;

  const now = new Date();
  const paidAt = paymentStatus === PaymentStatus.APPROVED ? now : null;

  if (transactionId) {
    await prisma.payment.upsert({
      where: {
        wompiTransactionId: transactionId
      },
      create: {
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        amountInCents: amountInCents ?? 0,
        currency: currency ?? "COP",
        cycleNumber: cycleFromRef,
        reference: reference ?? `SUB_${subscription.id}`,
        wompiTransactionId: transactionId,
        ...(subscriptionCycleKey ? { subscriptionCycleKey } : {}),
        status: paymentStatus,
        paidAt,
        providerResponse: payload
      },
      update: {
        status: paymentStatus,
        paidAt,
        ...(subscriptionCycleKey ? { subscriptionCycleKey } : {}),
        providerResponse: payload
      }
    });
  } else {
    await prisma.payment.create({
      data: {
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        amountInCents: amountInCents ?? 0,
        currency: currency ?? "COP",
        cycleNumber: cycleFromRef,
        reference: reference ?? `SUB_${subscription.id}`,
        ...(subscriptionCycleKey ? { subscriptionCycleKey } : {}),
        status: paymentStatus,
        paidAt,
        providerResponse: payload
      }
    });
  }

  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processStatus: WebhookProcessStatus.PROCESSED, processedAt: new Date() }
  });

  if (!wasApproved && paymentStatus === PaymentStatus.APPROVED) {
    await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id: subscription.id },
        include: { plan: true }
      });
      if (!sub) return;

      const cycle = cycleFromRef ?? sub.currentCycle;
      if (sub.currentCycle !== cycle) {
        logger.warn({ subscriptionId: sub.id, currentCycle: sub.currentCycle, paymentCycle: cycle }, "Cycle mismatch; not advancing");
        return;
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
      } else {
        logger.info({ subscriptionId: sub.id, nextEnd }, "Subscription advanced after payment approval");
      }
    });
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
