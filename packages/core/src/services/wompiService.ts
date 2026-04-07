import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { addIntervalUtc, toUtc } from "../lib/dates";
import { SubscriptionStatus } from "@prisma/client";
import { resolveSubscriptionCollectionMode } from "./subscriptionMode";
import { ensurePaymentRetryJob } from "./retryJobScheduler";

export async function advanceSubscriptionCycle(params: {
  subscriptionId: string;
  cycle: number;
  paidAt: Date;
}) {
  const { subscriptionId, cycle, paidAt } = params;

  return await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true }
    });
    if (!sub) return null;

    if (sub.currentCycle !== cycle) {
      logger.warn({ subscriptionId: sub.id, currentCycle: sub.currentCycle, paymentCycle: cycle }, "Cycle mismatch; not advancing");
      return null;
    }

    // FIX: Normalizar fechas a UTC para evitar problemas de timezone
    const cutoffUtc = sub.currentPeriodEndAt ? toUtc(sub.currentPeriodEndAt) : null;
    const paidAtUtc = paidAt ? toUtc(paidAt) : null;
    const nextStart = cutoffUtc ?? paidAtUtc ?? toUtc(new Date());
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
    }

    logger.info({ subscriptionId: sub.id, nextEnd }, "Subscription advanced after payment approval");
    const collectionMode = resolveSubscriptionCollectionMode(sub);

    if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
      await ensurePaymentRetryJob({
        subscriptionId: sub.id,
        runAt: collectionMode === "AUTO_LINK" && nextEnd <= new Date(Date.now() + 5_000) ? new Date() : nextEnd,
        maxAttempts: 1,
        db: tx
      }).catch((err: any) => {
        logger.warn({ err, subscriptionId: sub.id, nextEnd, collectionMode }, "wompiService: fallo reprogramando retry tras aprobación");
      });
    }

    return nextEnd;
  });
}
