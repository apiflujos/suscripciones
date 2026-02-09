import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { ChatwootMessageType, PaymentStatus, RetryJobType, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { addIntervalUtc } from "../../lib/dates";
import { getShopifyForward } from "../../services/runtimeConfig";
import { schedulePaymentStatusNotifications, scheduleSubscriptionDueNotifications } from "../../services/notificationsScheduler";
import { consumeApp } from "../../services/superAdminApp";
import { syncChatwootAttributesForCustomer } from "../../services/chatwootSync";

function getTransactionFromPayload(payload: any): any | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? tx : null;
}

function getCustomerEmailFromPayload(payload: any): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const email =
    tx?.customer_email ||
    tx?.customerEmail ||
    payload?.data?.customer_email ||
    payload?.data?.customerEmail ||
    tx?.customer_data?.email;
  const trimmed = String(email || "").trim().toLowerCase();
  return trimmed || undefined;
}

function getCustomerNameFromPayload(payload: any): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const name = tx?.customer_data?.full_name || tx?.customer_data?.name || tx?.customer_data?.fullName || tx?.customer?.name;
  const trimmed = String(name || "").trim();
  return trimmed || undefined;
}

function getCustomerPhoneFromPayload(payload: any): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const phone = tx?.customer_data?.phone_number || tx?.customer_data?.phoneNumber || tx?.customer?.phone_number || tx?.customer?.phone;
  const trimmed = String(phone || "").trim();
  return trimmed || undefined;
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

  // Shopify references are forwarded but not processed as subscriptions.
  if (!paymentByLink && referenceClassification.kind === "shopify") {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.SKIPPED, processedAt: new Date() }
    });
    return;
  }

  let inferredSubscriptionId =
    paymentByLink?.subscriptionId ??
    (referenceClassification.kind === "subscription" ? referenceClassification.subscriptionId : "");

  let inferredSubscription: { id: string } | null = null;
  if (!paymentByLink && !inferredSubscriptionId) {
    if (!amountInCents) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "missing_amount_in_cents", processedAt: new Date() }
      });
      return;
    }

    const plan = await prisma.subscriptionPlan.findFirst({
      where: {
        active: true,
        priceInCents: amountInCents,
        currency: (currency || "COP").toUpperCase()
      },
      orderBy: { updatedAt: "desc" }
    });

    if (!plan) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "plan_not_found_for_amount", processedAt: new Date() }
      });
      return;
    }

    const email = getCustomerEmailFromPayload(payload);
    if (!email) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "customer_email_missing", processedAt: new Date() }
      });
      return;
    }

    let customer = await prisma.customer.findUnique({ where: { email } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          email,
          name: getCustomerNameFromPayload(payload),
          phone: getCustomerPhoneFromPayload(payload)
        }
      });
    }

    const startAt = new Date();
    const periodEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);

    inferredSubscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        status: SubscriptionStatus.PAST_DUE,
        startAt,
        currentPeriodStartAt: startAt,
        currentPeriodEndAt: periodEnd,
        currentCycle: 1
      }
    });
    inferredSubscriptionId = inferredSubscription.id;
  }

  const subscriptionId = inferredSubscriptionId;

  const isSubscription = !!subscriptionId;
  // Registrar pago y, si está aprobado, renovar ciclo (solo para suscripciones).
  const subscription =
    inferredSubscription ??
    (isSubscription ? await prisma.subscription.findUnique({ where: { id: subscriptionId } }) : null);
  if (isSubscription && !subscription) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "subscription not found", processedAt: new Date() }
    });
    return;
  }

  const paymentStatus =
    status === "APPROVED"
      ? PaymentStatus.APPROVED
      : status === "DECLINED"
        ? PaymentStatus.DECLINED
        : status === "VOIDED"
          ? PaymentStatus.VOIDED
          : PaymentStatus.ERROR;

  const prevByTx = transactionId != null ? await prisma.payment.findUnique({ where: { wompiTransactionId: transactionId } }) : null;
  const prevStatus = prevByTx?.status ?? paymentByLink?.status ?? null;

  const cycleFromRef = referenceClassification.kind === "subscription" ? referenceClassification.cycle ?? null : null;
  const cycle = paymentByLink?.cycleNumber ?? cycleFromRef ?? (subscription?.currentCycle ?? 1);
  const subscriptionCycleKey = subscription ? `${subscription.id}:${cycle}` : null;
  const wasApproved = prevStatus === PaymentStatus.APPROVED;
  const wasFailed = prevStatus === PaymentStatus.DECLINED || prevStatus === PaymentStatus.ERROR || prevStatus === PaymentStatus.VOIDED;

  const now = new Date();
  const paidAt = paymentStatus === PaymentStatus.APPROVED ? now : null;
  const computedFailedAt = paymentStatus === PaymentStatus.APPROVED ? null : now;

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
          failedAt: paymentStatus === PaymentStatus.APPROVED ? null : paymentByLink.failedAt ?? computedFailedAt,
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
          failedAt: computedFailedAt,
          providerResponse: { webhook: payload } as any,
          subscriptionCycleKey: subscriptionCycleKey as string
        },
        update: {
          wompiTransactionId: transactionId,
          status: paymentStatus,
          paidAt,
          failedAt: paymentStatus === PaymentStatus.APPROVED ? null : computedFailedAt,
          providerResponse: { webhook: payload } as any,
          reference: reference ?? undefined,
          wompiPaymentLinkId: paymentLinkId ?? undefined
        }
      });

  if (paymentRecord.subscriptionId && paymentRecord.wompiPaymentLinkId && paymentRecord.checkoutUrl) {
    const planId =
      subscription?.planId ??
      (await prisma.subscription.findUnique({ where: { id: paymentRecord.subscriptionId }, select: { planId: true } }))?.planId;
    if (planId) {
      await prisma.paymentLink
        .upsert({
          where: { paymentId: paymentRecord.id },
          create: {
            planId,
            subscriptionId: paymentRecord.subscriptionId,
            paymentId: paymentRecord.id,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            checkoutUrl: paymentRecord.checkoutUrl,
            status: paymentRecord.status === PaymentStatus.APPROVED ? "PAID" : "SENT",
            sentAt: new Date(),
            paidAt: paymentRecord.paidAt ?? null
          },
          update: {
            planId,
            subscriptionId: paymentRecord.subscriptionId,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            checkoutUrl: paymentRecord.checkoutUrl,
            status: paymentRecord.status === PaymentStatus.APPROVED ? "PAID" : undefined,
            paidAt: paymentRecord.paidAt ?? null
          }
        })
        .catch(() => {});
    }
  }

  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: { processStatus: WebhookProcessStatus.PROCESSED, processedAt: new Date() }
  });

  await schedulePaymentStatusNotifications({ paymentId: paymentRecord.id }).catch(() => {});
  await syncChatwootAttributesForCustomer(paymentRecord.customerId).catch(() => {});

  const becameApproved = !wasApproved && paymentStatus === PaymentStatus.APPROVED;
  const becameFailed = !wasFailed && (paymentStatus === PaymentStatus.DECLINED || paymentStatus === PaymentStatus.ERROR || paymentStatus === PaymentStatus.VOIDED);
  if (becameApproved) {
    await consumeApp("payments_success", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
  } else if (becameFailed) {
    await consumeApp("payments_failed", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
  }

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

    // Notificaciones: la confirmación de pago se maneja por reglas (PAYMENT_APPROVED).
    if (advancedTo) {
      await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch(() => {});
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
