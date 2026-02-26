import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { systemLog } from "../../services/systemLog";
import { LogLevel } from "@prisma/client";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { PaymentStatus, RetryJobType, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { addIntervalUtc } from "../../lib/dates";
import { getShopifyForward } from "../../services/runtimeConfig";
import { schedulePaymentStatusNotifications, scheduleSubscriptionDueNotifications } from "../../services/notificationsScheduler";
import { consumeApp } from "../../services/superAdminApp";
import { syncChatwootAttributesForCustomer } from "../../services/chatwootSync";
import { getDefaultTenantId } from "../../services/tenantContext";

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

export async function processWompiEventLogic(webhookEventId: string, db: typeof prisma) {
  const event = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
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
    ? await db.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } })
    : null;
  const referenceClassification = classifyReference(reference);

  const paymentSource = String((paymentByLink?.providerResponse as any)?.order?.source || "").toUpperCase();
  const isShopifyPayment =
    referenceClassification.kind === "shopify" ||
    paymentSource === "SHOPIFY";

  // Shopify payments are forwarded but not processed as subscriptions.
  if (isShopifyPayment) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.SKIPPED, processedAt: new Date() }
    });
    return;
  }

  let inferredSubscriptionId =
    paymentByLink?.subscriptionId ??
    (referenceClassification.kind === "subscription" ? referenceClassification.subscriptionId : "");

  let inferredSubscription: any | null = null;
  
  // SOLO intentar inferencia por precio si NO tenemos un ID de suscripción de la referencia
  // y la referencia no es explícitamente de otro tipo (como shopify).
  const shouldAttemptPriceInference = !paymentByLink && !inferredSubscriptionId && (referenceClassification.kind === "unknown" || (referenceClassification.kind === "order" && !referenceClassification.planId));

  if (shouldAttemptPriceInference || (referenceClassification.kind === "order" && referenceClassification.planId)) {
    if (!amountInCents && shouldAttemptPriceInference) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "missing_amount_in_cents", processedAt: new Date() }
      });
      return;
    }

    const defaultTenantId = await getDefaultTenantId();
    let plan = null;
    if (referenceClassification.kind === "order" && referenceClassification.planId) {
      plan = await db.subscriptionPlan.findUnique({ where: { id: referenceClassification.planId } });
      if (plan && plan.priceInCents !== amountInCents) {
        await systemLog(LogLevel.WARN, "processWompiEvent", "Price mismatch with reference planId; using reference planId", {
          expected: plan.priceInCents,
          received: amountInCents,
          planId: plan.id
        }).catch(() => {});
      }
    }

    if (!plan) {
      const plans = await db.subscriptionPlan.findMany({
        where: {
          active: true,
          priceInCents: amountInCents,
          currency: (currency || "COP").toUpperCase(),
          ...(defaultTenantId ? { tenantId: defaultTenantId } : {})
        },
        orderBy: { updatedAt: "desc" }
      });

      if (plans.length === 0) {
        await db.webhookEvent.update({
          where: { id: webhookEventId },
          data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "plan_not_found_for_amount", processedAt: new Date() }
        });
        return;
      }

      if (plans.length > 1) {
        await systemLog(LogLevel.WARN, "processWompiEvent", "Ambiguous plan inference by price", {
          amountInCents,
          currency,
          foundPlans: plans.map((p) => ({ id: p.id, name: p.name }))
        }).catch(() => {});
      }
      plan = plans[0];
    }

    const email = getCustomerEmailFromPayload(payload);
    if (!email) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "customer_email_missing", processedAt: new Date() }
      });
      return;
    }

    let customer = await db.customer.findUnique({ where: { email } });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          tenantId: plan?.tenantId ?? defaultTenantId ?? null,
          email,
          name: getCustomerNameFromPayload(payload),
          phone: getCustomerPhoneFromPayload(payload)
        }
      });
    }

    const startAt = new Date();
    const periodEnd = addIntervalUtc(startAt, plan.intervalUnit, plan.intervalCount);

    inferredSubscription = await db.subscription.create({
      data: {
        tenantId: plan?.tenantId ?? defaultTenantId ?? null,
        customerId: customer.id,
        planId: plan.id,
        status: SubscriptionStatus.PAST_DUE,
        startAt,
        currentPeriodStartAt: startAt,
        currentPeriodEndAt: periodEnd,
        currentCycle: 1
      }
    });
    const linkTenantId = plan?.tenantId ?? defaultTenantId ?? null;
    if (linkTenantId) {
      await db.subscriptionTenant
        .createMany({
          data: [{ subscriptionId: inferredSubscription.id, tenantId: linkTenantId }],
          skipDuplicates: true
        })
        .catch(() => {});
    }
    inferredSubscriptionId = inferredSubscription.id;
  }

  const subscriptionId = inferredSubscriptionId;

  const isSubscription = !!subscriptionId;
  // Registrar pago y, si está aprobado, renovar ciclo (solo para suscripciones).
  const subscription =
    inferredSubscription ??
    (isSubscription ? await db.subscription.findUnique({ where: { id: subscriptionId } }) : null);
  if (isSubscription && !subscription) {
    await db.webhookEvent.update({
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

  const prevByTx = transactionId != null ? await db.payment.findUnique({ where: { wompiTransactionId: transactionId } }) : null;
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
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "payment not linked to subscription", processedAt: new Date() }
    });
    return;
  }

  const tenantIdForPayment =
    subscription?.tenantId ?? paymentByLink?.tenantId ?? (await getDefaultTenantId());

  const paymentRecord = paymentByLink
    ? await db.payment.update({
        where: { id: paymentByLink.id },
        data: {
          ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
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
    : await db.payment.upsert({
        where: { subscriptionCycleKey: subscriptionCycleKey as string },
        create: {
          ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
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
          ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
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
      (await db.subscription.findUnique({ where: { id: paymentRecord.subscriptionId }, select: { planId: true } }))?.planId;
    if (planId) {
      await db.paymentLink
        .upsert({
          where: { paymentId: paymentRecord.id },
          create: {
            ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
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
            ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
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

  await db.webhookEvent.update({
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
    const advancedTo = await db.$transaction(async (tx) => {
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

  // Notifications are handled via rules (PAYMENT_APPROVED / PAYMENT_DECLINED).
}

export async function processWompiEvent(webhookEventId: string) {
  return processWompiEventLogic(webhookEventId, prisma);
}

export async function forwardWompiToShopify(webhookEventId: string) {
  const cfg = await getShopifyForward();
  if (!cfg.url) return;

  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;

  const raw = event.payload as any;
  const data = raw && typeof raw === "object" ? raw.data : undefined;
  const transaction = data && typeof data === "object" ? data.transaction : undefined;
  const checksum = String(event.checksum || raw?.signature?.checksum || "").trim();
  const origin = cfg.origin === "shopify-native" ? "shopify-native" : "shopify";
  const payload = {
    ...(raw && typeof raw === "object" ? raw : {}),
    origin: raw?.origin ?? origin,
    sent_at: raw?.sent_at ?? new Date().toISOString(),
    data:
      data && typeof data === "object"
        ? {
            ...data,
            origin: (data as any).origin ?? origin,
            transaction:
              transaction && typeof transaction === "object"
                ? { ...transaction, origin: (transaction as any).origin ?? origin }
                : transaction
          }
        : data
  };

  const res = await postJson(cfg.url, payload, {
    "x-forwarded-by": "wompi-subs-api",
    ...(checksum ? { "x-event-checksum": checksum, "x-wompi-checksum": checksum } : {}),
    ...(cfg.secret ? { "x-forwarded-secret": cfg.secret } : {})
  });

  if (!res.ok) {
    const bodyText = res.text || "";
    const looksLikeSoftFail = res.status >= 500 && /internal server error/i.test(bodyText) && /\"success\"\s*:\s*false/i.test(bodyText);
    if (looksLikeSoftFail) {
      await systemLog(LogLevel.WARN, "shopify.forward", "Forward returned 5xx but treated as accepted", {
        webhookEventId,
        status: res.status,
        body: bodyText.slice(0, 2000),
        url: cfg.url
      }).catch(() => {});
      return;
    }
    await systemLog(LogLevel.ERROR, "shopify.forward", "Forward failed", {
      webhookEventId,
      status: res.status,
      body: bodyText.slice(0, 2000),
      url: cfg.url
    }).catch(() => {});
    throw new Error(`forward failed: ${res.status} ${bodyText}`);
  }
}
