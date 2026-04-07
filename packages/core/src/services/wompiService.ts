import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { addIntervalUtc, toUtc } from "../lib/dates";
import { SubscriptionStatus, PlanIntervalUnit } from "@prisma/client";
import { resolveSubscriptionCollectionMode } from "./subscriptionMode";
import { ensurePaymentRetryJob } from "./retryJobScheduler";

/**
 * Snap a date to the cycleStartDay of the month.
 * For monthly subscriptions, this ensures periods always start on the configured day
 * (e.g., the 1st) instead of drifting from the creation date.
 */
function snapToCycleStartDay(date: Date, cycleStartDay: number): Date {
  const day = Math.max(1, Math.min(31, Math.trunc(cycleStartDay || 1)));
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfMonth);
  return new Date(Date.UTC(y, m, clampedDay, 0, 0, 0, 0));
}

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

    const cutoffUtc = sub.currentPeriodEndAt ? toUtc(sub.currentPeriodEndAt) : null;
    const paidAtUtc = paidAt ? toUtc(paidAt) : null;
    const rawNextStart = cutoffUtc ?? paidAtUtc ?? toUtc(new Date());

    // FIX: For monthly subscriptions, snap the period start to cycleStartDay.
    // This prevents period drift when subscriptions are created on arbitrary dates.
    let nextStart = rawNextStart;
    if (sub.plan.intervalUnit === PlanIntervalUnit.MONTH) {
      const cycleStartDay = Math.max(1, Math.min(31, Math.trunc(sub.cycleStartDay || 1)));
      const snappedStart = snapToCycleStartDay(rawNextStart, cycleStartDay);
      // Only snap forward if the snapped date is after or equal to the raw next start.
      // If the snapped date is before, use the raw next start (we're already past it).
      if (snappedStart.getTime() >= rawNextStart.getTime()) {
        nextStart = snappedStart;
      } else {
        // We're past the cycleStartDay this month — snap to next month
        const nextMonth = new Date(Date.UTC(rawNextStart.getUTCFullYear(), rawNextStart.getUTCMonth() + 1, 0));
        nextStart = snapToCycleStartDay(nextMonth, cycleStartDay);
      }
    }

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

    logger.info({ subscriptionId: sub.id, nextStart, nextEnd }, "Subscription advanced after payment approval");
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
