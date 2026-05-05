import "server-only";

import { prisma } from "@suscripciones/database";
import { BillingCycleStatus, LogLevel, PaymentAssociationReason, PaymentOrigin, PaymentStatus, Prisma, RetryJobStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { getAutoDebitConfig } from "@suscripciones/core/services/runtimeConfig";
import { addIntervalUtc } from "@suscripciones/core/lib/dates";
import { systemLog } from "@suscripciones/core/services/systemLog";
import {
  attachPaymentToCycle,
  ensureBillingCyclesForSubscription,
  ensureBillingCyclesForSubscriptions,
  isBillingCyclePaid,
  resolveConfiguredCollectionCycle,
  resolveSubscriptionBillingState,
  syncSubscriptionBillingSnapshot
} from "@suscripciones/core/services/billingCycles";
import {
  createAutoDebitTransactionForSubscription,
  createPaymentLinkForSubscription,
  readSubscriptionTotalInCents
} from "@suscripciones/core/services/subscriptionBilling";
import { reconcileWompiTransaction } from "@suscripciones/core/services/wompiReconcile";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { validateWompiCurrency } from "@suscripciones/core/lib/wompiSignature";
import { logger } from "@suscripciones/core/lib/logger";
import { extractCustomerPaymentSourceId, readCustomerMetadata } from "@suscripciones/core/lib/customerMetadata";
import { recordManualChargeFailure, subscriptionIdJsonFilter } from "./subscriptionShared";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizePaymentTiming(value: unknown): "EN_CURSO" | "ANTICIPADO" {
  return String(value || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

export async function setSubscriptionRetryDate(args: {
  subscriptionId: string;
  nextRetryAt: string | null;
  tenantId?: string | null;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const nextRetryAt = args.nextRetryAt ? new Date(args.nextRetryAt) : null;
  const manualRetry = nextRetryAt
    ? { nextRetryAt: nextRetryAt.toISOString(), setAt: new Date().toISOString() }
    : null;

  const metadata = asRecord(subscription.metadata) || {};
  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      metadata: {
        ...metadata,
        manualRetry
      }
    }
  });

  if (nextRetryAt) {
    await ensurePaymentRetryJob({ subscriptionId, runAt: nextRetryAt, maxAttempts: 1 }).catch((err) => {
      logger.warn({ err, subscriptionId, nextRetryAt }, "Fallo programando retry manual de suscripcion");
    });
  } else {
    await prisma.retryJob.deleteMany({
      where: {
        type: RetryJobType.PAYMENT_RETRY,
        status: RetryJobStatus.PENDING,
        payload: subscriptionIdJsonFilter(subscriptionId)
      }
    }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo limpiando retries manuales pendientes de suscripcion");
    });
  }

  return { ok: true, subscription: updated };
}

export async function createSubscriptionPaymentLink(args: { subscriptionId: string; tenantId?: string | null; amountInCents?: number; sendNotifications?: boolean }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_id" as const };
  if (args.tenantId) {
    const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { tenantLinks: true } });
    if (!existing) return { ok: false, status: 404, error: "subscription_not_found" as const };
    const allowed =
      existing.tenantId === args.tenantId || (existing.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }
  try {
    const link = await createPaymentLinkForSubscription({
      subscriptionId,
      amountInCentsOverride: args.amountInCents,
      sendNotifications: args.sendNotifications
    });

    return { ok: true, ...link };
  } catch (err) {
    await systemLog(LogLevel.ERROR, "subscriptions.payment_link", "Payment link create failed", {
      subscriptionId,
      err: errorMessage(err)
    }).catch((logErr) => {
      logger.warn({ err: logErr, subscriptionId }, "Fallo escribiendo systemLog al crear payment link de suscripcion");
    });
    return { ok: false, status: 502, error: "wompi_payment_link_failed" as const };
  }
}

export async function chargeSubscriptionNow(args: { subscriptionId: string; tenantId?: string | null; amountInCents?: number; actor?: string | null }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, customer: true, tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode !== "AUTO_DEBIT") {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "manual_charge_not_allowed",
      details: { collectionMode }
    }).catch((err) => {
      logger.warn({ err, subscriptionId, collectionMode }, "Fallo registrando intento manual invalido de cobro");
      return null;
    });
    return { ok: false, status: 409, error: "manual_charge_not_allowed", ...(paymentId ? { paymentId } : {}) };
  }

  const autoDebitCfg = await getAutoDebitConfig();
  if (!autoDebitCfg.allowManualCharge) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "manual_charge_disabled_by_settings"
    }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo registrando intento manual bloqueado por configuracion");
      return null;
    });
    return { ok: false, status: 409, error: "manual_charge_disabled_by_settings", ...(paymentId ? { paymentId } : {}) };
  }

  const now = new Date();
  await ensureBillingCyclesForSubscriptions([
    {
      id: subscription.id,
      startAt: subscription.startAt,
      cycleStartDay: subscription.cycleStartDay,
      paymentDay: subscription.paymentDay,
      paymentTiming: normalizePaymentTiming(subscription.paymentTiming),
      graceDays: subscription.graceDays,
      plan: {
        intervalUnit: subscription.plan.intervalUnit,
        intervalCount: subscription.plan.intervalCount
      }
    }
  ]).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo asegurando ciclos de facturacion antes del cobro manual");
  });

  const openCycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId: subscription.id,
      paymentId: null,
      status: { not: "PAID" }
    },
    orderBy: [{ cycleNumber: "asc" }]
  });
  const targetCollectionCycle =
    resolveConfiguredCollectionCycle({
      cycles: openCycles,
      asOf: now,
      paymentTiming: normalizePaymentTiming(subscription.paymentTiming)
    }) || null;
  const overdueCycle = openCycles.find((cycle) => new Date(cycle.dueAt).getTime() <= now.getTime()) || null;
  const activeCycle = targetCollectionCycle || overdueCycle || openCycles.find((cycle) => {
    const startTs = new Date(cycle.periodStartAt).getTime();
    const endTs = new Date(cycle.periodEndAt).getTime();
    const nowTs = now.getTime();
    return startTs <= nowTs && nowTs < endTs;
  }) || null;
  const periodStartAt = activeCycle ? new Date(activeCycle.periodStartAt) : null;
  const periodEndAt = activeCycle ? new Date(activeCycle.periodEndAt) : null;
  const lastPaidInCurrentPeriod = isBillingCyclePaid(targetCollectionCycle || activeCycle);
  const bypassPaidCheck = Boolean(overdueCycle && overdueCycle.cycleNumber !== (activeCycle?.cycleNumber ?? 1));
  if (lastPaidInCurrentPeriod && !bypassPaidCheck) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "payment_already_approved",
      details: {
        paymentCycleNumber: (targetCollectionCycle || activeCycle)?.cycleNumber ?? null,
        paymentCycleStatus: String((targetCollectionCycle || activeCycle)?.status || ""),
        currentPeriodStartAt: periodStartAt?.toISOString() || null,
        currentPeriodEndAt: periodEndAt?.toISOString() || null
      }
    }).catch((err) => {
      logger.warn({ err, subscriptionId }, "Fallo registrando intento manual duplicado sobre pago ya aprobado");
      return null;
    });
    return { ok: false, status: 409, error: "payment_already_approved", ...(paymentId ? { paymentId } : {}) };
  }

  const recentPending = await prisma.payment.findFirst({
    where: {
      subscriptionId,
      status: PaymentStatus.PENDING,
      wompiTransactionId: { not: null },
      createdAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, wompiTransactionId: true, createdAt: true }
  });
  if (recentPending) {
    if (recentPending.wompiTransactionId && args.tenantId) {
      await reconcileWompiTransaction({
        wompiTransactionId: recentPending.wompiTransactionId,
        tenantId: args.tenantId,
        checksumPrefix: "manual-charge-precheck"
      }).catch((err) => {
        logger.warn(
          { err, subscriptionId, paymentId: recentPending.id, wompiTransactionId: recentPending.wompiTransactionId },
          "Fallo conciliando transaccion Wompi pendiente antes de cobro manual"
        );
      });
      const refreshed = await prisma.payment.findUnique({
        where: { id: recentPending.id },
        select: { status: true }
      });
      if (!(refreshed && refreshed.status !== PaymentStatus.PENDING)) {
        const details = {
          paymentId: recentPending.id,
          wompiTransactionId: recentPending.wompiTransactionId,
          createdAt: recentPending.createdAt
        };
        const failedPaymentId = await recordManualChargeFailure({
          subscription,
          amountInCentsOverride: args.amountInCents,
          errorCode: "pending_charge_exists",
          details
        }).catch(() => null);
        return { ok: false, status: 409, error: "pending_charge_exists", details, paymentId: failedPaymentId || recentPending.id };
      }
    } else {
      const details = {
        paymentId: recentPending.id,
        wompiTransactionId: recentPending.wompiTransactionId,
        createdAt: recentPending.createdAt
      };
      const failedPaymentId = await recordManualChargeFailure({
        subscription,
        amountInCentsOverride: args.amountInCents,
        errorCode: "pending_charge_exists",
        details
      }).catch(() => null);
      return { ok: false, status: 409, error: "pending_charge_exists", details, paymentId: failedPaymentId || recentPending.id };
    }
  }

  const paymentSource = extractCustomerPaymentSourceId(subscription.customer?.metadata);
  if (!paymentSource) {
    const meta = readCustomerMetadata(subscription.customer?.metadata);
    const details = { availableKeys: Object.keys(meta || {}), wompiKeys: Object.keys(meta.wompi || {}) };
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "customer_payment_source_missing",
      details
    }).catch(() => null);
    return { ok: false, status: 409, error: "customer_payment_source_missing", details, ...(paymentId ? { paymentId } : {}) };
  }
  if (!subscription.customer?.email) {
    const paymentId = await recordManualChargeFailure({
      subscription,
      amountInCentsOverride: args.amountInCents,
      errorCode: "customer_email_required"
    }).catch(() => null);
    return { ok: false, status: 409, error: "customer_email_required", ...(paymentId ? { paymentId } : {}) };
  }

  const cycleNumberOverride = targetCollectionCycle?.cycleNumber ?? overdueCycle?.cycleNumber ?? 1;
  try {
    const result = await createAutoDebitTransactionForSubscription({
      subscriptionId,
      amountInCentsOverride: args.amountInCents,
      forceNewTransaction: true,
      cycleNumberOverride,
      initiatedBy: args.actor || "system"
    });
    return { ok: true, ...result };
  } catch (err) {
    const paymentId =
      (
        await prisma.payment
          .findUnique({
            where: { subscriptionCycleKey: `${subscription.id}:${Number(cycleNumberOverride)}` },
            select: { id: true }
          })
          .catch(() => null)
      )?.id || null;
    return { ok: false, status: 502, error: errorMessage(err) || "charge_now_failed", ...(paymentId ? { paymentId } : {}) };
  }
}

export async function markSubscriptionPaidManual(args: {
  subscriptionId: string;
  tenantId?: string | null;
  method: "TRANSFERENCIA" | "BREB" | "EFECTIVO";
  actor?: string;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };
  const method = String(args.method || "").trim().toUpperCase();
  if (!["TRANSFERENCIA", "BREB", "EFECTIVO"].includes(method)) {
    return { ok: false, status: 400, error: "invalid_payment_method" as const };
  }

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }
  if (!subscription.plan) return { ok: false, status: 409, error: "plan_not_found" as const };

  const now = new Date();

  await ensureBillingCyclesForSubscriptions([
    {
      id: subscription.id,
      startAt: subscription.startAt,
      cycleStartDay: subscription.cycleStartDay,
      paymentDay: subscription.paymentDay,
      paymentTiming: normalizePaymentTiming(subscription.paymentTiming),
      graceDays: subscription.graceDays,
      plan: {
        intervalUnit: subscription.plan.intervalUnit,
        intervalCount: subscription.plan.intervalCount
      }
    }
  ]).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo asegurando ciclos de facturacion antes de marcar pago manual");
  });

  const openCycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId: subscription.id,
      paymentId: null,
      status: { not: "PAID" }
    },
    orderBy: [{ cycleNumber: "asc" }]
  });

  const targetCycle =
    resolveConfiguredCollectionCycle({
      cycles: openCycles,
      asOf: now,
      paymentTiming: normalizePaymentTiming(subscription.paymentTiming)
    }) ||
    openCycles.find((cycle) => {
      const startTs = new Date(cycle.periodStartAt).getTime();
      const endTs = new Date(cycle.periodEndAt).getTime();
      const nowTs = now.getTime();
      return startTs <= nowTs && nowTs < endTs;
    }) ||
    (await prisma.subscriptionBillingCycle.findUnique({
      where: { subscriptionId_cycleNumber: { subscriptionId: subscription.id, cycleNumber: 1 } }
    }));

  const cycleNumber = targetCycle?.cycleNumber ?? 1;
  const subscriptionCycleKey = `${subscription.id}:${cycleNumber}`;

  const existingByCycle = await prisma.payment.findUnique({
    where: { subscriptionCycleKey },
    select: { id: true, status: true }
  });
  if (existingByCycle?.status === PaymentStatus.APPROVED) {
    return { ok: true, paymentId: existingByCycle.id, alreadyApproved: true as const };
  }

  const result = await prisma.$transaction(async (tx) => {
    let paymentId = "";
    if (existingByCycle) {
      const updated = await tx.payment.update({
        where: { id: existingByCycle.id },
        data: {
          status: PaymentStatus.APPROVED,
          paidAt: now,
          failedAt: null,
          origin: PaymentOrigin.MANUAL_USER,
          associationReason: PaymentAssociationReason.MANUAL_RECONCILE,
          associatedBy: args.actor || "system",
          providerResponse: {
            manual: {
              method,
              actor: args.actor || null,
              at: now.toISOString()
            }
          } as Prisma.InputJsonValue
        },
        select: { id: true }
      });
      paymentId = updated.id;
    } else {
      const reference = `MANUAL_${subscription.id}_${cycleNumber}_${Date.now()}`;
      const created = await tx.payment.create({
        data: {
          tenantId: subscription.tenantId,
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          amountInCents: readSubscriptionTotalInCents(subscription.metadata, subscription.plan.priceInCents),
          currency: validateWompiCurrency(subscription.plan.currency),
          cycleNumber: cycleNumber,
          reference,
          status: PaymentStatus.APPROVED,
          paidAt: now,
          subscriptionCycleKey,
          origin: PaymentOrigin.MANUAL_USER,
          associationReason: PaymentAssociationReason.MANUAL_RECONCILE,
          associatedBy: args.actor || "system",
          providerResponse: {
            manual: {
              method,
              actor: args.actor || null,
              at: now.toISOString()
            }
          } as Prisma.InputJsonValue
        },
        select: { id: true }
      });
      paymentId = created.id;
    }

    if (targetCycle) {
      await attachPaymentToCycle({
        paymentId,
        subscriptionId: subscription.id,
        cycleId: targetCycle.id,
        paymentAt: now,
        origin: PaymentOrigin.MANUAL_USER,
        associationReason: "MANUAL_RECONCILE",
        associatedBy: args.actor || "system"
      }).catch((err) => {
        logger.warn({ err, subscriptionId: subscription.id, paymentId, cycleId: targetCycle.id }, "Fallo asociando pago manual al ciclo");
      });
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        retryCount: 0,
        suspendedAt: null,
        canceledAt: null
      }
    });

    return { paymentId };
  });

  await syncSubscriptionBillingSnapshot({ subscriptionId: subscription.id, asOf: now }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo sincronizando snapshot tras marcar pago manual");
  });

  const remainingOverdue = await prisma.subscriptionBillingCycle.count({
    where: {
      subscriptionId: subscription.id,
      paymentId: null,
      status: { not: "PAID" },
      dueAt: { lte: now }
    }
  });
  if (remainingOverdue > 0) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.PAST_DUE }
    }).catch((err) => {
      logger.warn({ err, subscriptionId: subscription.id }, "Fallo actualizando suscripcion a PAST_DUE tras marcado manual");
    });
  } else {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.ACTIVE }
    }).catch((err) => {
      logger.warn({ err, subscriptionId: subscription.id }, "Fallo actualizando suscripcion a ACTIVE tras marcado manual");
    });
  }

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: subscriptionIdJsonFilter(subscriptionId)
    }
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando notificaciones tras marcado manual de pago");
  });
  await systemLog(LogLevel.INFO, "subscriptions.manual_paid", "Subscription marked paid manually", {
    subscriptionId,
    method,
    paymentId: result.paymentId,
    actor: args.actor || null,
    at: now.toISOString()
  }, args.actor).catch((err) => {
    logger.warn({ err, subscriptionId, paymentId: result.paymentId }, "Fallo escribiendo systemLog de marcado manual de pago");
  });

  return { ok: true, paymentId: result.paymentId };
}

export async function unmarkSubscriptionPaidManual(args: {
  subscriptionId: string;
  tenantId?: string | null;
  actor?: string;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }
  if (!subscription.plan) return { ok: false, status: 409, error: "plan_not_found" as const };

  const linkedCycle = await prisma.subscriptionBillingCycle.findFirst({
    where: { subscriptionId: subscription.id, paymentId: { not: null } },
    orderBy: [{ cycleNumber: "desc" }]
  });
  const targetCycle = linkedCycle?.cycleNumber ?? ((linkedCycle?.cycleNumber ?? 2) - 1);
  if (targetCycle <= 0) return { ok: false, status: 409, error: "cycle_cannot_decrement" as const };
  const payment = await prisma.payment.findFirst({
    where: {
      subscriptionId: subscription.id,
      cycleNumber: targetCycle,
      status: PaymentStatus.APPROVED
    },
    orderBy: { createdAt: "desc" }
  });
  if (!payment) return { ok: false, status: 404, error: "approved_payment_not_found" as const };

  const providerResponse = asRecord(payment.providerResponse);
  const isManual = Boolean(providerResponse?.manual) || String(payment.reference || "").startsWith("MANUAL_");
  if (!isManual) return { ok: false, status: 409, error: "payment_not_manual" as const };

  const now = new Date();
  const cycleToReset =
    linkedCycle ||
    (await prisma.subscriptionBillingCycle.findFirst({
      where: { subscriptionId: subscription.id, paymentId: payment.id }
    }));

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PENDING,
        paidAt: null,
        failedAt: null,
        providerResponse: {
          ...(providerResponse || {}),
          manualUndo: {
            actor: args.actor || null,
            at: now.toISOString()
          }
        } as Prisma.InputJsonValue
      }
    });

    if (cycleToReset) {
      await tx.subscriptionBillingCycle.update({
        where: { id: cycleToReset.id },
        data: {
          paymentId: null,
          paidAt: null,
          paidOnTime: null,
          daysEarly: null,
          daysLate: null,
          origin: null,
          associationReason: null,
          associatedBy: null,
          status: BillingCycleStatus.PENDING
        }
      });
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.PAST_DUE
      }
    });
  });

  const snapshot = await syncSubscriptionBillingSnapshot({ subscriptionId: subscription.id, asOf: now }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo sincronizando snapshot tras desmarcar pago manual");
    return null;
  });
  const billingState = await resolveSubscriptionBillingState({ subscriptionId: subscription.id, asOf: now }).catch(() => null);
  const collectionCycle = billingState?.collectionCycle || snapshot?.collectionCycle || null;
  const hasOverdue = collectionCycle ? new Date(collectionCycle.dueAt || collectionCycle.periodEndAt).getTime() <= now.getTime() : false;
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: hasOverdue ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE
    }
  });

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode === "AUTO_DEBIT" || collectionMode === "AUTO_LINK") {
    const retryAt = collectionCycle ? new Date(collectionCycle.dueAt || collectionCycle.periodEndAt) : now;
    await ensurePaymentRetryJob({ subscriptionId: subscription.id, runAt: retryAt, maxAttempts: 1 }).catch((err) => {
      logger.warn({ err, subscriptionId: subscription.id, runAt: retryAt }, "Fallo reprogramando retry tras desmarcar pago manual");
    });
  }

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando notificaciones tras desmarcar pago manual");
  });
  await systemLog(LogLevel.INFO, "subscriptions.manual_unpaid", "Subscription manual payment unmarked", {
    subscriptionId,
    paymentId: payment.id,
    previousCycle: targetCycle,
    actor: args.actor || null,
    at: now.toISOString()
  }, args.actor).catch((err) => {
    logger.warn({ err, subscriptionId, paymentId: payment.id }, "Fallo escribiendo systemLog de desmarcado manual");
  });

  return { ok: true, paymentId: payment.id };
}

export async function scheduleSubscriptionCutoff(args: { subscriptionId: string; cutoffAt: string; tenantId?: string | null }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  const cutoffAtRaw = String(args.cutoffAt || "").trim();
  if (!subscriptionId || !cutoffAtRaw) return { ok: false, status: 400, error: "invalid_cutoff_date" as const };

  const cutoffAt = new Date(cutoffAtRaw);
  if (Number.isNaN(cutoffAt.getTime())) return { ok: false, status: 400, error: "invalid_cutoff_date" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, tenantLinks: true }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode !== "AUTO_DEBIT" && collectionMode !== "AUTO_LINK") {
    return { ok: false, status: 409, error: "schedule_cutoff_not_allowed" as const };
  }

  const billingState = await resolveSubscriptionBillingState({ subscriptionId, asOf: new Date() }).catch(() => null);
  const activeCycle = billingState?.activeCycle || null;

  if (
    subscription.status === SubscriptionStatus.ACTIVE &&
    activeCycle?.periodEndAt &&
    cutoffAt.getTime() < new Date(activeCycle.periodEndAt).getTime()
  ) {
    return { ok: false, status: 409, error: "cutoff_cannot_move_backwards" as const };
  }

  const updated = subscription;

  await ensureBillingCyclesForSubscription({
    id: updated.id,
    startAt: updated.startAt,
    currentCycle: activeCycle?.cycleNumber ?? 1,
    currentPeriodStartAt: activeCycle?.periodStartAt ? new Date(activeCycle.periodStartAt) : updated.startAt,
    currentPeriodEndAt: cutoffAt,
    cycleStartDay: updated.cycleStartDay,
    paymentDay: updated.paymentDay,
    paymentTiming: normalizePaymentTiming(updated.paymentTiming),
    graceDays: updated.graceDays,
    plan: {
      intervalUnit: subscription.plan.intervalUnit,
      intervalCount: subscription.plan.intervalCount
    }
  }).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo regenerando ciclos tras cambiar cutoff");
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: subscriptionIdJsonFilter(subscriptionId)
    }
  });

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando notificaciones tras cambiar cutoff");
  });

  await ensurePaymentRetryJob({
    subscriptionId,
    runAt: cutoffAt <= new Date(Date.now() + 5_000) ? new Date() : cutoffAt,
    maxAttempts: 1
  }).catch((err) => {
    logger.warn({ err, subscriptionId, cutoffAt }, "Fallo reprogramando retry tras cambiar cutoff");
  });

  const autoDebitConfig = await getAutoDebitConfig();
  if (
    collectionMode === "AUTO_DEBIT" &&
    autoDebitConfig.enabled &&
    autoDebitConfig.chargeAtCutoffEnabled &&
    cutoffAt <= new Date(Date.now() + 5_000)
  ) {
    await createAutoDebitTransactionForSubscription({
      subscriptionId,
      forceNewTransaction: true
    }).catch((err) => {
      const msg = String(err?.message || "");
      if (!msg.includes("payment_already_approved")) {
        systemLog(LogLevel.WARN, "subscriptions.cutoff", "Immediate cutoff charge failed", {
          subscriptionId,
          err: msg
        }).catch((logErr) => {
          logger.warn({ err: logErr, subscriptionId }, "Fallo escribiendo systemLog de cobro inmediato fallido por cutoff");
        });
      }
    });
  }

  return { ok: true, subscription: updated, scheduledAt: cutoffAt.toISOString(), scheduled: true };
}

export async function recalcSubscriptionCutoff(args: { subscriptionId: string; tenantId?: string | null }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { ok: false, status: 400, error: "invalid_subscription_id" as const };

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: true,
      tenantLinks: true,
      payments: {
        where: { status: PaymentStatus.APPROVED },
        orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    }
  });
  if (!subscription) return { ok: false, status: 404, error: "subscription_not_found" as const };
  if (args.tenantId) {
    const allowed =
      subscription.tenantId === args.tenantId || (subscription.tenantLinks || []).some((t) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "subscription_not_found" as const };
  }
  if (!subscription.plan) return { ok: false, status: 409, error: "plan_not_found" as const };

  const billingStateForRecalc = await resolveSubscriptionBillingState({ subscriptionId, asOf: new Date() }).catch(() => null);
  const baseStart = billingStateForRecalc?.activeCycle?.periodEndAt || subscription.startAt || subscription.createdAt;
  const nextEnd = addIntervalUtc(baseStart, subscription.plan.intervalUnit, subscription.plan.intervalCount);
  const updated = subscription;

  await ensureBillingCyclesForSubscription({
    id: updated.id,
    startAt: updated.startAt,
    currentCycle: (billingStateForRecalc?.activeCycle?.cycleNumber ?? 0) + 1,
    currentPeriodStartAt: new Date(baseStart),
    currentPeriodEndAt: nextEnd,
    cycleStartDay: updated.cycleStartDay,
    paymentDay: updated.paymentDay,
    paymentTiming: normalizePaymentTiming(updated.paymentTiming),
    graceDays: updated.graceDays,
    plan: {
      intervalUnit: subscription.plan.intervalUnit,
      intervalCount: subscription.plan.intervalCount
    }
  }).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo regenerando ciclos al recalcular cutoff");
  });

  await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING,
      payload: subscriptionIdJsonFilter(subscriptionId)
    }
  });

  const collectionMode = resolveSubscriptionCollectionMode(subscription);
  if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
    await ensurePaymentRetryJob({
      subscriptionId,
      runAt: nextEnd <= new Date(Date.now() + 5_000) ? new Date() : nextEnd,
      maxAttempts: 1
    }).catch((err) => {
      logger.warn({ err, subscriptionId, runAt: nextEnd }, "Fallo reprogramando retry al recalcular cutoff");
    });
  }

  await scheduleSubscriptionDueNotifications({ subscriptionId: subscription.id }).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando notificaciones al recalcular cutoff");
  });
  await systemLog(LogLevel.INFO, "subscriptions.recalculate_cutoff", "Subscription cutoff recalculated", {
    subscriptionId,
    startAt: baseStart.toISOString(),
    endAt: nextEnd.toISOString()
  }).catch((err) => {
    logger.warn({ err, subscriptionId }, "Fallo escribiendo systemLog de recalculo de cutoff");
  });

  return { ok: true, subscription: updated, startAt: baseStart, endAt: nextEnd };
}
