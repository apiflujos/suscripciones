import { prisma } from "../../db/prisma";
import { LogLevel, RetryJobStatus, RetryJobType } from "@prisma/client";
import { createAutoDebitTransactionForSubscription, createPaymentLinkForSubscription } from "../../services/subscriptionBilling";
import { systemLog } from "../../services/systemLog";
import { addIntervalUtc } from "../../lib/dates";
import { getAutoDebitConfig } from "../../services/runtimeConfig";

function shouldCreateFallbackLinkWhenAutoDebitDisabled() {
  const raw = String(process.env.AUTO_DEBIT_DISABLED_FALLBACK_LINK || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export async function paymentRetry(payload: any) {
  const subscriptionId = String(payload?.subscriptionId || "").trim();
  if (!subscriptionId) return;
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
  if (!sub) return;

  const mode = String((sub.plan.metadata as any)?.collectionMode || "MANUAL_LINK");
  if (mode === "AUTO_DEBIT" || mode === "AUTO_LINK") {
    const now = new Date();
    const recentPendingAutoCharge = await prisma.payment.findFirst({
      where: {
        subscriptionId,
        status: "PENDING",
        wompiTransactionId: { not: null },
        createdAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) }
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, wompiTransactionId: true, createdAt: true }
    });
    if (recentPendingAutoCharge) {
      const nextRunAt = new Date(now.getTime() + 30 * 60 * 1000);
      const alreadyScheduled = await prisma.retryJob.findFirst({
        where: {
          type: RetryJobType.PAYMENT_RETRY,
          status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
          payload: { path: ["subscriptionId"], equals: subscriptionId } as any,
          runAt: { gte: new Date(now.getTime() - 60_000) }
        },
        select: { id: true }
      });
      if (!alreadyScheduled) {
        await prisma.retryJob
          .create({
            data: {
              type: RetryJobType.PAYMENT_RETRY,
              runAt: nextRunAt,
              maxAttempts: 5,
              payload: { subscriptionId }
            }
          })
          .catch(() => {});
      }
      await systemLog(LogLevel.WARN, "jobs.payment_retry", "Cobro automático omitido: ya existe cobro pendiente reciente", {
        subscriptionId,
        mode,
        pendingPaymentId: recentPendingAutoCharge.id,
        wompiTransactionId: recentPendingAutoCharge.wompiTransactionId,
        pendingCreatedAt: recentPendingAutoCharge.createdAt?.toISOString?.() || recentPendingAutoCharge.createdAt,
        reScheduledAt: nextRunAt.toISOString()
      }).catch(() => {});
      return;
    }

    const latestApproved = await prisma.payment.findFirst({
      where: { subscriptionId, status: "APPROVED", paidAt: { not: null } },
      orderBy: { paidAt: "desc" },
      select: { paidAt: true }
    });
    const dueByLastPayment = latestApproved?.paidAt
      ? addIntervalUtc(latestApproved.paidAt, sub.plan.intervalUnit, sub.plan.intervalCount)
      : null;
    const dueByCutoff = sub.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
    const dueAt =
      dueByCutoff && dueByLastPayment
        ? (dueByCutoff.getTime() >= dueByLastPayment.getTime() ? dueByCutoff : dueByLastPayment)
        : (dueByCutoff || dueByLastPayment);

    if (dueAt && now.getTime() + 5_000 < dueAt.getTime()) {
      const alreadyScheduled = await prisma.retryJob.findFirst({
        where: {
          type: RetryJobType.PAYMENT_RETRY,
          status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
          payload: { path: ["subscriptionId"], equals: subscriptionId } as any,
          runAt: { gte: new Date(dueAt.getTime() - 60_000) }
        },
        select: { id: true }
      });
      if (!alreadyScheduled) {
        await prisma.retryJob.create({
          data: {
            type: RetryJobType.PAYMENT_RETRY,
            runAt: dueAt,
            maxAttempts: 5,
            payload: { subscriptionId }
          }
        }).catch(() => {});
      }
      await systemLog(LogLevel.INFO, "jobs.payment_retry", "Cobro automático omitido: aún no es fecha de cobro", {
        subscriptionId,
        mode,
        dueAt: dueAt.toISOString(),
        now: now.toISOString(),
        byCutoff: dueByCutoff ? dueByCutoff.toISOString() : null,
        byLastPayment: dueByLastPayment ? dueByLastPayment.toISOString() : null
      }).catch(() => {});
      return;
    }
  }

  if (mode === "AUTO_DEBIT") {
    const autoDebitConfig = await getAutoDebitConfig();
    if (!autoDebitConfig.enabled) {
      await systemLog(LogLevel.WARN, "jobs.payment_retry", "Débito automático deshabilitado desde configuración; cobro omitido", {
        subscriptionId,
        source: "settings.auto_debit.enabled"
      }).catch(() => {});
      if (shouldCreateFallbackLinkWhenAutoDebitDisabled()) {
        await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
      }
      return;
    }
    try {
      await createAutoDebitTransactionForSubscription({ subscriptionId });
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : "unknown error";
      const isMissingSource = msg === "customer_payment_source_missing";
      await systemLog(
        isMissingSource ? LogLevel.WARN : LogLevel.ERROR,
        "jobs.payment_retry",
        isMissingSource ? "Auto-debit sin token; creando link manual" : "Auto-debit charge failed; attempting emergency link",
        { subscriptionId, err: msg }
      ).catch(() => {});
      // Emergency fallback: generate a payment link so the user can pay manually.
      await createPaymentLinkForSubscription({ subscriptionId }).catch(() => {});
      if (!isMissingSource) throw err;
    }
    return;
  }

  await createPaymentLinkForSubscription({ subscriptionId });
}
