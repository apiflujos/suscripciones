import { hasExhaustedCycleAttempts } from "../../services/collectionAttempts";
import { prisma } from "../../db/prisma";
import { LogLevel } from "@prisma/client";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { systemLog, SystemActor } from "../../services/systemLog";
import { getAutoDebitConfig } from "../../services/runtimeConfig";
import { resolveSubscriptionCollectionMode } from "../../services/subscriptionMode";
import { resolveEffectiveSubscriptionAutomationConfig } from "../../services/subscriptionAutomationConfig";
import { publishRealtime } from "../../services/realtimePublisher";
import { resolveSubscriptionBillingState, syncSubscriptionBillingSnapshot } from "../../services/billingCycles";
import { logger } from "../../lib/logger";
import { extractCustomerPaymentSourceId } from "../../lib/customerMetadata";

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

function hasUsableCustomerPaymentSource(metadata: unknown) {
  return Number.isFinite(extractCustomerPaymentSourceId(metadata));
}

async function createFallbackPaymentLinkOrThrow(args: {
  subscriptionId: string;
  customerId: string;
  reason: string;
  originalError?: string | null;
}) {
  try {
    await createPaymentLinkForSubscription({ subscriptionId: args.subscriptionId });
  } catch (err: any) {
    const fallbackError = err?.message ? String(err.message) : "unknown";
    await systemLog(
      LogLevel.ERROR,
      "jobs.payment_retry",
      "Fallo al crear link de pago de respaldo",
      {
        subscriptionId: args.subscriptionId,
        customerId: args.customerId,
        reason: args.reason,
        originalError: args.originalError || null,
        fallbackError
      },
      SystemActor.JOB_PAYMENT_RETRY
    ).catch((logErr: any) => {
      logger.warn({ err: logErr, subscriptionId: args.subscriptionId, customerId: args.customerId }, "Fallo escribiendo systemLog por fallback de link");
    });
    throw new Error(`payment_link_fallback_failed:${fallbackError}`);
  }
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
    if (sub.status === "SUSPENDED") return { status: "skipped", mode: "MANUAL_LINK" as const, reason: "subscription_suspended", subscriptionId };
    await syncSubscriptionBillingSnapshot({ subscriptionId }).catch(() => null);
    const billingState = await resolveSubscriptionBillingState({ subscriptionId }).catch(() => null);

    // Validar email del cliente (requerido para Wompi)
    if (!sub.customer?.email) {
      await systemLog(LogLevel.ERROR, "jobs.payment_retry", "Cliente sin email - imposible cobrar", {
        subscriptionId,
        customerId: sub.customerId
      }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
        logger.warn({ err: logErr, subscriptionId, customerId: sub.customerId }, "Fallo escribiendo systemLog por cliente sin email");
      });
      throw new Error("customer_email_required");
    }

    // Validar payment source para AUTO_DEBIT
    const collectionMode = resolveSubscriptionCollectionMode(sub);
    if (collectionMode === "AUTO_DEBIT") {
      const hasPaymentSource = hasUsableCustomerPaymentSource(sub.customer.metadata);
      if (!hasPaymentSource) {
        await systemLog(LogLevel.WARN, "jobs.payment_retry", "Cliente sin token - creando link de pago", {
          subscriptionId,
          customerId: sub.customerId
        }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
          logger.warn({ err: logErr, subscriptionId, customerId: sub.customerId }, "Fallo escribiendo systemLog por cliente sin token");
        });
        void publishRealtime("payments", {
          type: "payment_retry_missing_token",
          subscriptionId,
          customerId: sub.customerId,
          updatedAt: new Date().toISOString()
        });
        await createFallbackPaymentLinkOrThrow({
          subscriptionId,
          customerId: sub.customerId,
          reason: "missing_payment_source"
        });
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
      const autoDebitConfig = await resolveEffectiveSubscriptionAutomationConfig(sub).catch(() => getAutoDebitConfig());
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
        if (!autoDebitConfig.retryEnabled) {
          await systemLog(LogLevel.INFO, "jobs.payment_retry", "Cobro automático omitido: ya existe cobro pendiente y los reintentos están deshabilitados", {
            subscriptionId,
            mode,
            pendingPaymentId: recentPendingAutoCharge.id,
            wompiTransactionId: recentPendingAutoCharge.wompiTransactionId,
            pendingCreatedAt: recentPendingAutoCharge.createdAt?.toISOString?.() || recentPendingAutoCharge.createdAt
          }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
            logger.warn({ err: logErr, subscriptionId, pendingPaymentId: recentPendingAutoCharge.id }, "Fallo escribiendo systemLog por cobro pendiente con reintentos deshabilitados");
          });
          return {
            status: "skipped",
            mode,
            reason: "pending_charge_exists",
            subscriptionId
          };
        }
        await systemLog(LogLevel.WARN, "jobs.payment_retry", "Cobro automático omitido: ya existe cobro pendiente reciente", {
          subscriptionId,
          mode,
          pendingPaymentId: recentPendingAutoCharge.id,
          wompiTransactionId: recentPendingAutoCharge.wompiTransactionId,
          pendingCreatedAt: recentPendingAutoCharge.createdAt?.toISOString?.() || recentPendingAutoCharge.createdAt
        }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
          logger.warn({ err: logErr, subscriptionId, pendingPaymentId: recentPendingAutoCharge.id }, "Fallo escribiendo systemLog por cobro pendiente reciente");
        });
        void publishRealtime("payments", {
          type: "payment_retry_skipped_pending",
          subscriptionId,
          customerId: sub.customerId,
          pendingPaymentId: recentPendingAutoCharge.id,
          updatedAt: new Date().toISOString()
        });
        return {
          status: "skipped",
          mode,
          reason: "pending_charge_exists",
          subscriptionId
        };
      }

      const dueCycle = billingState?.collectionCycle || null;
      const dueByCutoff = dueCycle?.periodEndAt ? new Date(dueCycle.periodEndAt) : null;
      const dueAt = dueCycle?.dueAt ? new Date(dueCycle.dueAt) : null;

      if (dueAt && now.getTime() + 5_000 < dueAt.getTime()) {
        await systemLog(LogLevel.INFO, "jobs.payment_retry", "Cobro automático omitido: aún no es fecha de cobro", {
          subscriptionId,
          mode,
          dueAt: dueAt.toISOString(),
          now: now.toISOString(),
          byCutoff: dueByCutoff ? dueByCutoff.toISOString() : null
        }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
          logger.warn({ err: logErr, subscriptionId, dueAt }, "Fallo escribiendo systemLog por cobro fuera de fecha");
        });
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
      const autoDebitConfig = await resolveEffectiveSubscriptionAutomationConfig(sub).catch(() => getAutoDebitConfig());
      if (!autoDebitConfig.enabled) {
        if (shouldCreateFallbackLinkWhenAutoDebitDisabled()) {
          await systemLog(LogLevel.INFO, "jobs.payment_retry", "Débito automático deshabilitado; creando link de respaldo", {
            subscriptionId,
            source: "settings.auto_debit.enabled"
          }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
            logger.warn({ err: logErr, subscriptionId }, "Fallo escribiendo systemLog por auto debit deshabilitado");
          });
          void publishRealtime("payments", {
            type: "payment_retry_auto_debit_disabled",
            subscriptionId,
            customerId: sub.customerId,
            updatedAt: new Date().toISOString()
          });
          await createFallbackPaymentLinkOrThrow({
            subscriptionId,
            customerId: sub.customerId,
            reason: "auto_debit_disabled"
          });
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
      // Tope duro por ciclo. Un cobro declinado no lanza error, así que sin
      // esto el ciclo se vuelve a cobrar en cada pasada del sincronizador.
      // ⛔ ESTE .catch DEVOLVÍA `exhausted: false`, o sea: si no se podía contar
      // cuántas veces se había cobrado ya el ciclo, se cobraba igual. El tope que
      // existe justo para cortar el bucle de 62 cobros fallaba ABIERTO ante un
      // fallo transitorio de base.
      //
      // Cuando no se puede verificar cuántas veces se pasó la tarjeta, la
      // respuesta correcta es no pasarla: aplazar el cobro cuesta un ciclo del
      // worker, cobrar de más le cuesta al cliente y al comercio el bloqueo del
      // medio de pago.
      const intentos = await hasExhaustedCycleAttempts({
        subscriptionId,
        cycleNumber: billingState?.collectionCycle?.cycleNumber ?? null,
        config: autoDebitConfig
      }).catch(async (err: any) => {
        await systemLog(LogLevel.ERROR, "jobs.payment_retry", "No se pudo verificar los intentos del ciclo: no se cobra", {
          subscriptionId,
          cycleNumber: billingState?.collectionCycle?.cycleNumber ?? null,
          err: err?.message ? String(err.message) : String(err)
        }, SystemActor.JOB_PAYMENT_RETRY).catch(() => {});
        return { exhausted: true, attempts: -1, allowed: -1 };
      });
      if (intentos.exhausted) {
        await systemLog(LogLevel.WARN, "jobs.payment_retry", "Cobro automático detenido: el ciclo agotó sus intentos", {
          subscriptionId,
          mode,
          cycleNumber: billingState?.collectionCycle?.cycleNumber ?? null,
          attempts: intentos.attempts,
          allowed: intentos.allowed
        }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
          logger.warn({ err: logErr, subscriptionId }, "Fallo escribiendo systemLog por intentos agotados");
        });
        return {
          status: "skipped",
          mode,
          reason: "cycle_attempts_exhausted",
          subscriptionId
        };
      }

      try {
        await createAutoDebitTransactionForSubscription({
          subscriptionId,
          forceNewTransaction: false
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

        // Log detallado del fallo para debug
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
            hasPaymentSource: hasUsableCustomerPaymentSource(sub.customer.metadata),
            collectionMode: mode,
            subscriptionStatus: sub.status,
            currentCycle: billingState?.activeCycle?.cycleNumber ?? null,
            currentPeriodEndAt: billingState?.activeCycle?.periodEndAt?.toISOString?.() || null,
            errorDetails: err?.details || err?.cause || null,
            wompiTransactionId: err?.wompiTransactionId || null,
            reference: err?.reference || null
          }, SystemActor.JOB_PAYMENT_RETRY).catch((logErr: any) => {
            logger.warn({ err: logErr, subscriptionId, customerId: sub.customerId }, "Fallo escribiendo systemLog por fallo en cobro automático");
          });
        
        void publishRealtime("payments", {
          type: isMissingSource ? "payment_retry_missing_token" : "payment_retry_failed",
          subscriptionId,
          customerId: sub.customerId,
          error: msg,
          updatedAt: new Date().toISOString()
        });

        await createFallbackPaymentLinkOrThrow({
          subscriptionId,
          customerId: sub.customerId,
          reason: isMissingSource ? "missing_payment_source" : "auto_debit_charge_failed",
          originalError: msg
        });

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
    await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch((err: any) => {
      logger.warn({ err, subscriptionId, lockKey }, "Fallo liberando advisory lock de payment retry");
    });
  }
}
