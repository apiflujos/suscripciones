import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { systemLog } from "../../services/systemLog";
import { GamificationEntityType, LogLevel, Prisma, type Subscription } from "@prisma/client";
import { classifyReference } from "../../webhooks/wompi/classifyReference";
import { postJson } from "../../lib/http";
import { PaymentLinkStatus, PaymentStatus, RetryJobType, SubscriptionStatus, WebhookProcessStatus } from "@prisma/client";
import { addIntervalUtc } from "../../lib/dates";
import { getShopifyForward, getWompiCheckoutLinkBaseUrl } from "../../services/runtimeConfig";
import { schedulePaymentStatusNotifications, scheduleSubscriptionDueNotifications } from "../../services/notificationsScheduler";
import { consumeApp } from "../../services/superAdminApp";
import { syncChatwootAttributesForCustomer } from "../../services/chatwootSync";
import { getDefaultTenantId } from "../../services/tenantContext";
import { applyGamificationEvent, GAMIFICATION_EVENT_KINDS } from "../../services/gamification";
import { GAMIFICATION_WEIGHTS, moneyToPoints } from "../../services/gamificationConfig";

type WompiCustomerData = {
  full_name?: string;
  name?: string;
  fullName?: string;
  email?: string;
  phone_number?: string;
  phoneNumber?: string;
};

type WompiCustomer = {
  name?: string;
  phone_number?: string;
  phone?: string;
};

type WompiTransaction = {
  id?: string;
  reference?: string;
  payment_link_id?: string;
  paymentLinkId?: string;
  status?: string;
  amount_in_cents?: number;
  amountInCents?: number;
  currency?: string;
  customer_email?: string;
  customerEmail?: string;
  customer_data?: WompiCustomerData;
  customer?: WompiCustomer;
  finalized_at?: string | number;
  finalizedAt?: string | number;
  created_at?: string | number;
  createdAt?: string | number;
  paid_at?: string | number;
  paidAt?: string | number;
};

type WompiPayload = {
  data?: {
    transaction?: WompiTransaction;
    customer_email?: string;
    customerEmail?: string;
  };
  signature?: { checksum?: string };
  event?: string;
};

function getTransactionFromPayload(payload: WompiPayload): WompiTransaction | null {
  const tx = payload?.data?.transaction;
  return tx && typeof tx === "object" ? tx : null;
}

function getCustomerEmailFromPayload(payload: WompiPayload): string | undefined {
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

function getCustomerNameFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const name = tx?.customer_data?.full_name || tx?.customer_data?.name || tx?.customer_data?.fullName || tx?.customer?.name;
  const trimmed = String(name || "").trim();
  return trimmed || undefined;
}

function getCustomerPhoneFromPayload(payload: WompiPayload): string | undefined {
  const tx = getTransactionFromPayload(payload);
  const phone = tx?.customer_data?.phone_number || tx?.customer_data?.phoneNumber || tx?.customer?.phone_number || tx?.customer?.phone;
  const trimmed = String(phone || "").trim();
  return trimmed || undefined;
}

function getPaidAtFromPayload(payload: WompiPayload): Date | null {
  const tx = getTransactionFromPayload(payload);
  const raw =
    tx?.paid_at ||
    tx?.paidAt ||
    tx?.finalized_at ||
    tx?.finalizedAt ||
    tx?.created_at ||
    tx?.createdAt;
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getPaymentSourceFromProviderResponse(resp: unknown) {
  if (!resp || typeof resp !== "object") return "";
  const order = (resp as Record<string, unknown>).order;
  if (!order || typeof order !== "object") return "";
  return String((order as Record<string, unknown>).source || "").toUpperCase();
}

export async function processWompiEventLogic(webhookEventId: string, db: typeof prisma) {
  const event = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;
  if (event.processStatus === WebhookProcessStatus.PROCESSED) return;

  const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as WompiPayload;
  const tx = getTransactionFromPayload(payload);
  const reference: string | undefined = tx?.reference;
  const transactionId: string | undefined = tx?.id;
  const paymentLinkId: string | undefined = tx?.payment_link_id ?? tx?.paymentLinkId;
  const status: string | undefined = tx?.status;
  const amountInCents: number | undefined = tx?.amount_in_cents ?? tx?.amountInCents;
  const currency: string | undefined = tx?.currency;
  const checkoutUrlFromLink = paymentLinkId
    ? (() => {
        const rawBase = getWompiCheckoutLinkBaseUrl();
        return rawBase.then((base) => {
          const normalized = base.endsWith("/") ? base : `${base}/`;
          return `${normalized}${paymentLinkId}`;
        });
      })()
    : Promise.resolve<string | undefined>(undefined);

  // Prefer mapping by payment_link_id (subscriptions created via API payment links)
  let paymentByLink = paymentLinkId
    ? await db.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } })
    : null;
  const paymentLinkRecord = paymentLinkId
    ? await db.paymentLink.findUnique({
        where: { wompiPaymentLinkId: paymentLinkId },
        select: { paymentId: true, subscriptionId: true }
      })
    : null;
  if (!paymentByLink && paymentLinkRecord?.paymentId) {
    paymentByLink = await db.payment.findUnique({ where: { id: paymentLinkRecord.paymentId } });
  }
  const referenceClassification = classifyReference(reference);

  const paymentSource = getPaymentSourceFromProviderResponse(paymentByLink?.providerResponse);
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
    paymentLinkRecord?.subscriptionId ??
    (referenceClassification.kind === "subscription" ? referenceClassification.subscriptionId : "");

  let inferredSubscription: Subscription | null = null;
  
  const missingPaymentLinkRecord = Boolean(paymentLinkId && !paymentByLink && !paymentLinkRecord);
  if (missingPaymentLinkRecord) {
    const canProceedByReference =
      referenceClassification.kind === "subscription" ||
      (referenceClassification.kind === "order" && referenceClassification.planId);
    if (!canProceedByReference) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.SKIPPED, errorMessage: "payment_link_external", processedAt: new Date() }
      });
      return;
    }
    await systemLog(LogLevel.WARN, "processWompiEvent", "payment_link_not_found: proceeding by reference", {
      paymentLinkId,
      reference
    }).catch(() => {});
  }

  const shouldAttemptPriceInference =
    !paymentByLink &&
    !inferredSubscriptionId &&
    (referenceClassification.kind === "unknown" || (referenceClassification.kind === "order" && !referenceClassification.planId));

  if (shouldAttemptPriceInference || (referenceClassification.kind === "order" && referenceClassification.planId)) {
    if (!amountInCents && shouldAttemptPriceInference) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "missing_amount_in_cents", processedAt: new Date() }
      });
      return;
    }

    const defaultTenantId = await getDefaultTenantId();
    const baseTenantId = event.tenantId || defaultTenantId || null;
    let plan: { id: string; tenantId?: string | null; intervalUnit: any; intervalCount: number; priceInCents?: number; currency?: string; name?: string } | null = null;
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
          ...(baseTenantId ? { tenantId: baseTenantId } : {})
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
        if (missingPaymentLinkRecord) {
          await db.webhookEvent.update({
            where: { id: webhookEventId },
            data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "plan_ambiguous_without_link", processedAt: new Date() }
          });
          return;
        }
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
          tenantId: plan?.tenantId ?? baseTenantId ?? null,
          email,
          name: getCustomerNameFromPayload(payload),
          phone: getCustomerPhoneFromPayload(payload)
        }
      });
    }

    const startAt = new Date();
    const planResolved = plan as { id: string; tenantId?: string | null; intervalUnit: any; intervalCount: number };
    const inferredTenantId = planResolved?.tenantId ?? baseTenantId;
    if (!inferredTenantId) {
      await db.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "missing_tenant", processedAt: new Date() }
      });
      return;
    }
    const periodEnd = addIntervalUtc(startAt, planResolved.intervalUnit, planResolved.intervalCount);

    inferredSubscription = await db.subscription.create({
      data: {
        tenantId: inferredTenantId,
        customerId: customer.id,
        planId: planResolved.id,
        status: SubscriptionStatus.PAST_DUE,
        startAt,
        currentPeriodStartAt: startAt,
        currentPeriodEndAt: periodEnd,
        currentCycle: 1
      }
    });
    await db.subscriptionTenant
      .createMany({
        data: [{ subscriptionId: inferredSubscription.id, tenantId: inferredTenantId }],
        skipDuplicates: true
      })
      .catch(() => {});
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

  const normalizedStatus = String(status || "").toUpperCase();
  const paymentStatus =
    normalizedStatus === "APPROVED"
      ? PaymentStatus.APPROVED
      : normalizedStatus === "DECLINED"
        ? PaymentStatus.DECLINED
        : normalizedStatus === "ERROR"
          ? PaymentStatus.ERROR
          : normalizedStatus === "VOIDED"
            ? PaymentStatus.VOIDED
            : normalizedStatus === "PENDING" || normalizedStatus === "PROCESSING"
              ? PaymentStatus.PENDING
              : null;

  const prevByTx = transactionId != null ? await db.payment.findUnique({ where: { wompiTransactionId: transactionId } }) : null;
  const prevStatus = prevByTx?.status ?? paymentByLink?.status ?? null;

  const cycleFromRef = referenceClassification.kind === "subscription" ? referenceClassification.cycle ?? null : null;
  const cycle = paymentByLink?.cycleNumber ?? cycleFromRef ?? (subscription?.currentCycle ?? 1);
  const subscriptionCycleKey = subscription ? `${subscription.id}:${cycle}` : null;
  const wasApproved = prevStatus === PaymentStatus.APPROVED;
  const wasFailed = prevStatus === PaymentStatus.DECLINED || prevStatus === PaymentStatus.ERROR || prevStatus === PaymentStatus.VOIDED;

  const now = new Date();
  const paidAt = paymentStatus === PaymentStatus.APPROVED ? (getPaidAtFromPayload(payload) ?? now) : null;
  const computedFailedAt = paymentStatus && paymentStatus !== PaymentStatus.APPROVED && paymentStatus !== PaymentStatus.PENDING ? now : null;

  if (!paymentByLink && !subscription) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "payment not linked to subscription", processedAt: new Date() }
    });
    return;
  }

  const tenantIdForPayment =
    subscription?.tenantId ?? paymentByLink?.tenantId ?? (await getDefaultTenantId());
  if (!tenantIdForPayment) {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processStatus: WebhookProcessStatus.FAILED, errorMessage: "missing_tenant", processedAt: new Date() }
    });
    return;
  }

  const checkoutUrlResolved = await checkoutUrlFromLink;
  const resolvedCheckoutUrl =
    paymentByLink?.checkoutUrl ||
    prevByTx?.checkoutUrl ||
    checkoutUrlResolved;
  const wompiTransactionUpdate = transactionId ? { wompiTransactionId: transactionId } : {};

  const paymentRecord = paymentByLink
    ? await db.payment.update({
        where: { id: paymentByLink.id },
        data: {
          ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
          ...wompiTransactionUpdate,
          ...(paymentStatus ? { status: paymentStatus } : {}),
          paidAt,
          failedAt:
            paymentStatus === PaymentStatus.APPROVED
              ? null
              : paymentStatus === PaymentStatus.PENDING
                ? paymentByLink.failedAt ?? null
                : paymentByLink.failedAt ?? computedFailedAt,
          providerResponse:
            paymentByLink.providerResponse && typeof paymentByLink.providerResponse === "object"
              ? ({ ...(paymentByLink.providerResponse as Record<string, unknown>), webhook: payload } as Prisma.InputJsonValue)
              : ({ webhook: payload } as Prisma.InputJsonValue),
          amountInCents: amountInCents ?? paymentByLink.amountInCents,
          currency: currency ?? paymentByLink.currency,
          reference: reference ?? paymentByLink.reference,
          ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
          cycleNumber: paymentByLink.cycleNumber ?? cycle,
          subscriptionCycleKey: paymentByLink.subscriptionId ? subscriptionCycleKey : paymentByLink.subscriptionCycleKey
        }
      })
    : await db.payment.upsert({
        where: { subscriptionCycleKey: subscriptionCycleKey as string },
        create: {
          tenant: { connect: { id: tenantIdForPayment! } },
          customer: { connect: { id: subscription!.customerId } },
          subscription: { connect: { id: subscription!.id } },
          amountInCents: amountInCents ?? 0,
          currency: currency ?? "COP",
          cycleNumber: cycle,
          reference: reference ?? `SUB_${subscription!.id}_${cycle}`,
          ...wompiTransactionUpdate,
          wompiPaymentLinkId: paymentLinkId,
          ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
          ...(paymentStatus ? { status: paymentStatus } : {}),
          paidAt,
          failedAt: computedFailedAt,
          providerResponse: { webhook: payload } as Prisma.InputJsonValue,
          subscriptionCycleKey: subscriptionCycleKey as string
        },
        update: {
          ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
          ...wompiTransactionUpdate,
          ...(paymentStatus ? { status: paymentStatus } : {}),
          paidAt,
          failedAt:
            paymentStatus === PaymentStatus.APPROVED
              ? null
              : paymentStatus === PaymentStatus.PENDING
                ? prevByTx?.failedAt ?? null
                : prevByTx?.failedAt ?? computedFailedAt,
          providerResponse: { webhook: payload } as Prisma.InputJsonValue,
          reference: reference ?? undefined,
          ...(resolvedCheckoutUrl ? { checkoutUrl: resolvedCheckoutUrl } : {}),
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
            tenantId: tenantIdForPayment,
            planId,
            subscriptionId: paymentRecord.subscriptionId,
            paymentId: paymentRecord.id,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            checkoutUrl: paymentRecord.checkoutUrl,
            status: paymentRecord.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : PaymentLinkStatus.SENT,
            sentAt: new Date(),
            paidAt: paymentRecord.paidAt ?? null
          },
          update: {
            ...(tenantIdForPayment ? { tenantId: tenantIdForPayment } : {}),
            planId,
            subscriptionId: paymentRecord.subscriptionId,
            wompiPaymentLinkId: paymentRecord.wompiPaymentLinkId,
            checkoutUrl: paymentRecord.checkoutUrl,
            status: paymentRecord.status === PaymentStatus.APPROVED ? PaymentLinkStatus.PAID : undefined,
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

  await schedulePaymentStatusNotifications({ paymentId: paymentRecord.id, forceNow: true }).catch(() => {});
  await syncChatwootAttributesForCustomer(paymentRecord.customerId).catch(() => {});

  const becameApproved = !wasApproved && paymentStatus === PaymentStatus.APPROVED;
  const becameFailed = !wasFailed && (paymentStatus === PaymentStatus.DECLINED || paymentStatus === PaymentStatus.ERROR || paymentStatus === PaymentStatus.VOIDED);
  if (becameApproved) {
    await consumeApp("payments_success", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
  } else if (becameFailed) {
    await consumeApp("payments_failed", { amount: 1, source: "wompi:webhook", meta: { paymentId: paymentRecord.id } });
  }

  if (becameApproved) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: paymentRecord.customerId,
      tenantId: tenantIdForPayment,
      kind: GAMIFICATION_EVENT_KINDS.PAYMENT_APPROVED,
      moneyInCents: paymentRecord.amountInCents,
      metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
    }).catch(() => {});

    if (subscription?.planId) {
      const moneyPts = moneyToPoints(paymentRecord.amountInCents, GAMIFICATION_WEIGHTS.paymentApproved.moneyScale);
      await applyGamificationEvent({
        entityType: GamificationEntityType.PRODUCT,
        entityId: subscription.planId,
        tenantId: tenantIdForPayment,
        kind: "product.payment.approved",
        moneyInCents: paymentRecord.amountInCents,
        statusDelta: GAMIFICATION_WEIGHTS.paymentApproved.status + moneyPts,
        lifetimeDelta: GAMIFICATION_WEIGHTS.paymentApproved.lifetime + moneyPts,
        metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
      }).catch(() => {});
    }
  } else if (becameFailed) {
    await applyGamificationEvent({
      entityType: GamificationEntityType.CUSTOMER,
      entityId: paymentRecord.customerId,
      tenantId: tenantIdForPayment,
      kind: GAMIFICATION_EVENT_KINDS.PAYMENT_FAILED,
      moneyInCents: paymentRecord.amountInCents,
      metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
    }).catch(() => {});

    if (subscription?.planId) {
      await applyGamificationEvent({
        entityType: GamificationEntityType.PRODUCT,
        entityId: subscription.planId,
        tenantId: tenantIdForPayment,
        kind: "product.payment.failed",
        moneyInCents: paymentRecord.amountInCents,
        statusDelta: GAMIFICATION_WEIGHTS.paymentFailed.status,
        lifetimeDelta: GAMIFICATION_WEIGHTS.paymentFailed.lifetime,
        metadata: { paymentId: paymentRecord.id, subscriptionId: paymentRecord.subscriptionId || null }
      }).catch(() => {});
    }
  }

  if (paymentStatus === PaymentStatus.APPROVED && subscription) {
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

      const meta: any = (sub.metadata ?? {}) as any;
      const manualCharge = meta?.manualCharge;
      const manualCycle = manualCharge && typeof manualCharge === "object" ? Number(manualCharge.cycle ?? NaN) : NaN;
      const manualAtRaw = manualCharge && typeof manualCharge === "object" ? String(manualCharge.at || "") : "";
      const manualAt = manualAtRaw ? new Date(manualAtRaw) : null;
      const useManualAnchor = Number.isFinite(manualCycle) && manualCycle === cycle && manualAt && !Number.isNaN(manualAt.getTime());

      // Next billing anchor should be the last successful payment date.
      const nextStart = useManualAnchor ? (paidAt ?? manualAt!) : (paidAt ?? sub.currentPeriodEndAt);
      const nextEnd = addIntervalUtc(nextStart, sub.plan.intervalUnit, sub.plan.intervalCount);

      const nextMeta = useManualAnchor
        ? (() => {
            const copy: any = meta && typeof meta === "object" ? { ...meta } : {};
            delete copy.manualCharge;
            return copy;
          })()
        : null;

      const updated = await tx.subscription.updateMany({
        where: { id: sub.id, currentCycle: sub.currentCycle },
        data: {
          status: SubscriptionStatus.ACTIVE,
          retryCount: 0,
          currentCycle: { increment: 1 },
          currentPeriodStartAt: nextStart,
          currentPeriodEndAt: nextEnd,
          ...(useManualAnchor ? { metadata: nextMeta as Prisma.InputJsonValue } : {})
        }
      });

      if (updated.count === 0) {
        logger.warn({ subscriptionId: sub.id }, "Subscription already advanced (idempotent)");
        return null;
      } else {
        logger.info({ subscriptionId: sub.id, nextEnd }, "Subscription advanced after payment approval");
        const collectionMode = (sub.plan.metadata as any)?.collectionMode;
        // Single attempt at next cutoff (no retries).
        if (collectionMode === "AUTO_LINK") {
          await tx.retryJob
            .create({
              data: {
                type: RetryJobType.PAYMENT_RETRY,
                runAt: nextEnd <= new Date(Date.now() + 5_000) ? new Date() : nextEnd,
                maxAttempts: 1,
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
                maxAttempts: 1,
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
}

export async function processWompiEvent(webhookEventId: string) {
  return processWompiEventLogic(webhookEventId, prisma);
}

export async function forwardWompiToShopify(webhookEventId: string) {
  const cfg = await getShopifyForward();
  if (!cfg.url) return;

  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;

  const raw = (event.payload && typeof event.payload === "object"
    ? event.payload
    : {}) as { signature?: { checksum?: string } } & Record<string, unknown>;
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>).data : undefined;
  const transaction = data && typeof data === "object" ? (data as Record<string, unknown>).transaction : undefined;
  const dataRecord = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const txRecord = transaction && typeof transaction === "object" ? (transaction as Record<string, unknown>) : null;
  const checksum = String(event.checksum || raw?.signature?.checksum || "").trim();
  const origin = cfg.origin === "shopify-native" ? "shopify-native" : "shopify";
  const payload = {
    ...(raw && typeof raw === "object" ? raw : {}),
    origin: (raw as Record<string, unknown>)?.origin ?? origin,
    sent_at: (raw as Record<string, unknown>)?.sent_at ?? new Date().toISOString(),
    data:
      data && typeof data === "object"
        ? {
            ...dataRecord,
            origin: dataRecord?.origin ?? origin,
            transaction:
              transaction && typeof transaction === "object"
                ? { ...txRecord, origin: txRecord?.origin ?? origin }
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
