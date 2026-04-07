import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { SubscriptionStatus } from "@prisma/client";
import { resolveSubscriptionCollectionMode } from "./subscriptionMode";
import { ensurePaymentRetryJob } from "./retryJobScheduler";
import { resolveSubscriptionBillingState, syncSubscriptionBillingSnapshot } from "./billingCycles";

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

    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        retryCount: 0
      }
    });
    await syncSubscriptionBillingSnapshot({ subscriptionId: sub.id, asOf: paidAt }).catch(() => null);
    const state = await resolveSubscriptionBillingState({ subscriptionId: sub.id, asOf: paidAt }).catch(() => null);
    const nextEnd = state?.activeCycle?.periodEndAt ? new Date(state.activeCycle.periodEndAt) : null;
    const nextRunAt = state?.collectionCycle?.dueAt ? new Date(state.collectionCycle.dueAt) : null;
    logger.info({ subscriptionId: sub.id, nextEnd, nextRunAt }, "Subscription snapshot synchronized after payment approval");
    const collectionMode = resolveSubscriptionCollectionMode(sub);

    if (nextRunAt && (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT")) {
      await ensurePaymentRetryJob({
        subscriptionId: sub.id,
        runAt: nextRunAt,
        maxAttempts: 1,
        db: tx
      }).catch((err: any) => {
        logger.warn({ err, subscriptionId: sub.id, nextRunAt, collectionMode }, "wompiService: fallo reprogramando retry tras aprobación");
      });
    }

    return nextEnd;
  });
}
