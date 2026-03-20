import { prisma } from "../../db/prisma";
import { LogLevel } from "@prisma/client";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { systemLog, SystemActor } from "../../services/systemLog";
import { getAutoDebitConfig } from "../../services/runtimeConfig";
import { resolveSubscriptionCollectionMode } from "../../services/subscriptionMode";
import { publishRealtime } from "../../services/realtimePublisher";

function shouldCreateFallbackLinkWhenAutoDebitDisabled() {
  const raw = String(process.env.AUTO_DEBIT_DISABLED_FALLBACK_LINK || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export type PaymentRetryResult =
  | { status: "processed"; mode: "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK"; action: "AUTO_DEBIT_CHARGE" | "PAYMENT_LINK_CREATED"; subscriptionId: string }
  | { status: "deferred"; mode: "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK"; reason: string; subscriptionId: string; nextRunAt: Date }
  | { status: "skipped"; mode: "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK"; reason: string; subscriptionId: string };

function asResultMode(raw: string): "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK" {
  const mode = String(raw || "").trim().toUpperCase();
  if (mode === "AUTO_DEBIT") return "AUTO_DEBIT";
  if (mode === "AUTO_LINK") return "AUTO_LINK";
  return "MANUAL_LINK";
}

export async function paymentRetry(payload: any): Promise<PaymentRetryResult> {
  const subscriptionId = String(payload?.subscriptionId || "").trim();
  if (!subscriptionId) {
    throw new Error("subscription_not_found");
  }

  const lockKey = `payment-retry:${subscriptionId}`;
  const lockAcquired = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) as locked
  `.then(rows => Boolean(rows?.[0]?.locked)).catch(() => false);

  if (!lockAcquired) {
    return { status: "deferred", mode: "MANUAL_LINK", reason: "lock_failed", subscriptionId, nextRunAt: new Date(Date.now() + 60_000) };
  }

  try {
    const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true, customer: true } });
    if (!sub) throw new Error("subscription_not_found");
    if (sub.status === "CANCELED") throw new Error("subscription_canceled");

    // Validar email del cliente (requerido para Wompi)
    if (!sub.customer?.email) {
      await systemLog(LogLevel.ERROR, "jobs.payment_retry", "Cliente sin email - imposible cobrar", {
        subscriptionId,
        customerId: sub.customerId
      }, SystemActor.JOB_PAYMENT_RETRY).catch(() => {});
      throw new Error("customer_email_required");
    }

    // Validar payment source para AUTO_DEBIT
    const collectionMode = resolveSubscriptionCollectionMode(sub);
    if (collectionMode === "AUTO_DEBIT") {
      const paymentSourceId = (sub.customer.metadata as any)?.wompi?.paymentSourceId;
      if (!paymentSourceId) {
        await systemLog(LogLevel.WARN, "jobs.payment_retry", "Cliente sin token - creando link de pago", {
          subscriptionId,
          customerId: sub.customerId
        }, SystemActor.JOB_PAYMENT_RETRY).catch(() => {});
        void publishRealtime("payments", {
          type: "payment_retry_missing_token",
          subscriptionId,
          customerId: sub.customerId,
          updatedAt: new Date().toISOString()
        });
        // Fallback: crear link de pago en vez de fallar
        await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
        return {
          status: "processed",
          mode: collectionMode,
          action: "PAYMENT_LINK_CREATED",
          subscriptionId
        };
      }
    }

    const mode = resolveSubscriptionCollectionMode(sub);
    if (mode === "AUTO_DEBIT" || mode === "AUTO_LINK") {
      const autoDebitConfig = await getAutoDebitConfig();
      const now = new Date();

      const retryWindowMinutes = autoDebitConfig.retryEnabled
        ? (autoDebitConfig.retryEveryMinutes * Math.max(1, autoDebitConfig.maxRetries) * 2)
        : 120;
      const safetyWindowMinutes = Math.max(30, retryWindowMinutes);

      const recentPendingAutoCharge = await prisma.payment.findFirst({
        where: {
          subscriptionId,
          status: "PENDING",
          wompiTransactionId: { not: null },
          createdAt: { gte: new Date(now.getTime() - safetyWindowMinutes * 60 * 1000) }
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, wompiTransactionId: true, createdAt: true }
      });
      if (recentPendingAutoCharge) {
        const nextRunAt = new Date(now.getTime() + 30 * 60 * 1000);
        await systemLog(LogLevel.WARN, "jobs.payment_retry", "Cobro automático omitido: ya existe cobro pendiente reciente", {
          subscriptionId,
          mode,
          pendingPaymentId: recentPendingAutoCharge.id,
          wompiTransactionId: recentPendingAutoCharge.wompiTransactionId,
          pendingCreatedAt: recentPendingAutoCharge.createdAt?.toISOString?.() || recentPendingAutoCharge.createdAt,
          reScheduledAt: nextRunAt.toISOString()
        }, SystemActor.JOB_PAYMENT_RETRY).catch(() => {});
        void publishRealtime("payments", {
          type: "payment_retry_deferred_pending",
          subscriptionId,
          customerId: sub.customerId,
          pendingPaymentId: recentPendingAutoCharge.id,
          updatedAt: new Date().toISOString()
        });
        return {
          status: "deferred",
          mode,
          reason: "pending_charge_exists",
          subscriptionId,
          nextRunAt
        };
      }

      const dueByCutoff = sub.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
      const dueAt = dueByCutoff;

      if (dueAt && now.getTime() + 5_000 < dueAt.getTime()) {
        await systemLog(LogLevel.INFO, "jobs.payment_retry", "Cobro automático omitido: aún no es fecha de cobro", {
          subscriptionId,
          mode,
          dueAt: dueAt.toISOString(),
          now: now.toISOString(),
          byCutoff: dueByCutoff ? dueByCutoff.toISOString() : null
        }, SystemActor.JOB_PAYMENT_RETRY).catch(() => {});
        void publishRealtime("payments", {
          type: "payment_retry_deferred_not_due",
          subscriptionId,
          customerId: sub.customerId,
          dueAt: dueAt.toISOString(),
          updatedAt: new Date().toISOString()
        });
        return {
          status: "deferred",
          mode,
          reason: "not_due_yet",
          subscriptionId,
          nextRunAt: dueAt
        };
      }
    }

    if (mode === "AUTO_DEBIT") {
      const autoDebitConfig = await getAutoDebitConfig();
      if (!autoDebitConfig.enabled) {
        if (shouldCreateFallbackLinkWhenAutoDebitDisabled()) {
          await systemLog(LogLevel.INFO, "jobs.payment_retry", "Débito automático deshabilitado; creando link de respaldo", {
            subscriptionId,
            source: "settings.auto_debit.enabled"
          }, SystemActor.JOB_PAYMENT_RETRY).catch(() => {});
          void publishRealtime("payments", {
            type: "payment_retry_auto_debit_disabled",
            subscriptionId,
            customerId: sub.customerId,
            updatedAt: new Date().toISOString()
          });
          await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
          return {
            status: "processed",
            mode,
            action: "PAYMENT_LINK_CREATED",
            subscriptionId
          };
        }
        return {
          status: "skipped",
          mode,
          reason: "auto_debit_disabled",
          subscriptionId
        };
      }
      try {
        await createAutoDebitTransactionForSubscription({ 
          subscriptionId, 
          forceNewTransaction: true
        });
        void publishRealtime("payments", {
          type: "payment_retry_charge_created",
          subscriptionId,
          customerId: sub.customerId,
          updatedAt: new Date().toISOString()
        });
        return {
          status: "processed",
          mode,
          action: "AUTO_DEBIT_CHARGE",
          subscriptionId
        };
      } catch (err: any) {
        const msg = err?.message ? String(err.message) : "unknown error";
        const isMissingSource = msg === "customer_payment_source_missing";
        
        await systemLog(
          isMissingSource ? LogLevel.WARN : LogLevel.ERROR,
          "jobs.payment_retry",
          isMissingSource ? "Auto-debit sin token; creando link manual" : "Fallo en cobro automático",
          {
            subscriptionId,
            customerId: sub.customerId,
            error: msg,
            stack: err?.stack,
            email: sub.customer?.email,
            hasPaymentSource: Boolean((sub.customer.metadata as any)?.wompi?.paymentSourceId)
          }, SystemActor.JOB_PAYMENT_RETRY).catch(() => {});
        void publishRealtime("payments", {
          type: isMissingSource ? "payment_retry_missing_token" : "payment_retry_failed",
          subscriptionId,
          customerId: sub.customerId,
          error: msg,
          updatedAt: new Date().toISOString()
        });
        
        await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
        if (!isMissingSource) throw err;
        return {
          status: "processed",
          mode,
          action: "PAYMENT_LINK_CREATED",
          subscriptionId
        };
      }
    }

    await createPaymentLinkForSubscription({ subscriptionId });
    return {
      status: "processed",
      mode: asResultMode(mode),
      action: "PAYMENT_LINK_CREATED",
      subscriptionId
    };
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch(() => {});
  }
}
