import { BillingCycleStatus, RetryJobStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/prisma";

function subscriptionFilter() {
  const subscriptionId = String(process.env.SUBSCRIPTION_ID || "").trim();
  return subscriptionId ? { id: subscriptionId } : {};
}

async function normalizeTerminalStates() {
  const result = await prisma.subscription.updateMany({
    where: {
      ...subscriptionFilter(),
      status: { in: [SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED] }
    },
    data: {
      status: SubscriptionStatus.PAST_DUE,
      suspendedAt: null,
      canceledAt: null
    }
  });
  return result.count;
}

async function cleanupPendingPaymentRetries() {
  const filter = subscriptionFilter();
  if ("id" in filter) {
    const result = await prisma.retryJob.deleteMany({
      where: {
        type: RetryJobType.PAYMENT_RETRY,
        status: RetryJobStatus.PENDING,
        payload: { path: ["subscriptionId"], equals: filter.id } as any
      }
    });
    return result.count;
  }

  const result = await prisma.retryJob.deleteMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING
    }
  });
  return result.count;
}

async function cleanupLegacyCycles() {
  const subs = await prisma.subscription.findMany({
    where: subscriptionFilter(),
    select: { id: true, startAt: true }
  });
  let deleted = 0;
  for (const sub of subs) {
    const result = await prisma.subscriptionBillingCycle.deleteMany({
      where: {
        subscriptionId: sub.id,
        status: { not: BillingCycleStatus.PAID },
        periodStartAt: { lt: sub.startAt }
      }
    });
    deleted += result.count;
  }
  return deleted;
}

async function cleanupOverlappingUnpaidCycles() {
  const subs = await prisma.subscription.findMany({
    where: subscriptionFilter(),
    select: { id: true }
  });
  let deleted = 0;

  for (const sub of subs) {
    const cycles = await prisma.subscriptionBillingCycle.findMany({
      where: { subscriptionId: sub.id },
      orderBy: [{ cycleNumber: "asc" }, { periodStartAt: "asc" }]
    });

    let lastKeptEndAt: Date | null = null;
    const toDelete: string[] = [];

    for (const cycle of cycles) {
      if (cycle.status === BillingCycleStatus.PAID) {
        lastKeptEndAt = new Date(cycle.periodEndAt);
        continue;
      }

      if (lastKeptEndAt && new Date(cycle.periodStartAt).getTime() < lastKeptEndAt.getTime()) {
        toDelete.push(cycle.id);
        continue;
      }

      lastKeptEndAt = new Date(cycle.periodEndAt);
    }

    if (!toDelete.length) continue;
    const result = await prisma.subscriptionBillingCycle.deleteMany({
      where: { id: { in: toDelete } }
    });
    deleted += result.count;
  }

  return deleted;
}

async function main() {
  const normalizedStatuses = await normalizeTerminalStates();
  const deletedLegacyCycles = await cleanupLegacyCycles();
  const deletedOverlappingCycles = await cleanupOverlappingUnpaidCycles();
  const deletedPendingRetries = await cleanupPendingPaymentRetries();

  console.log(JSON.stringify({
    scope: String(process.env.SUBSCRIPTION_ID || "").trim() || "all",
    normalizedStatuses,
    deletedLegacyCycles,
    deletedOverlappingCycles,
    deletedPendingRetries
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
