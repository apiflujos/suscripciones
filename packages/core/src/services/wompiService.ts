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

    const meta: any = (sub.metadata ?? {}) as any;
    const manualCharge = meta?.manualCharge;
    const manualCycle = manualCharge && typeof manualCharge === "object" ? Number(manualCharge.cycle ?? NaN) : NaN;
    const manualAtRaw = manualCharge && typeof manualCharge === "object" ? String(manualCharge.at || "") : "";
    const manualAt = manualAtRaw ? new Date(manualAtRaw) : null;
    const useManualAnchor = Number.isFinite(manualCycle) && manualCycle === cycle && manualAt && !Number.isNaN(manualAt.getTime());

    // FIX: Normalizar fechas a UTC para evitar problemas de timezone
    const paidAtUtc = paidAt ? toUtc(paidAt) : toUtc(sub.currentPeriodEndAt);
    const manualAtUtc = manualAt ? toUtc(manualAt) : null;
    
    const nextStart = useManualAnchor
      ? (manualAtUtc ?? paidAtUtc)
      : paidAtUtc;
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
        ...(useManualAnchor ? { metadata: nextMeta as any } : {})
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
      }).catch(() => {});
    }

    return nextEnd;
  });
}
