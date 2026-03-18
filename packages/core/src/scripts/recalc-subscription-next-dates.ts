import { prisma } from "../db/prisma";
import { addIntervalUtc } from "../lib/dates";
import { RetryJobStatus, RetryJobType, SubscriptionStatus } from "@prisma/client";

function normalizeDate(d?: Date | null) {
  if (!d) return null;
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

async function main() {
  const subs = await prisma.subscription.findMany({
    where: {
      status: { notIn: [SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED] },
      payments: { some: { status: "APPROVED" } }
    },
    include: {
      plan: true,
      payments: {
        where: { status: "APPROVED" },
        orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    }
  });

  let updated = 0;
  let scheduled = 0;
  const now = Date.now();

  for (const sub of subs) {
    const lastPayment = sub.payments?.[0];
    if (!lastPayment || !sub.plan) continue;

    const startAt = lastPayment.paidAt || lastPayment.updatedAt || lastPayment.createdAt;
    const endAt = addIntervalUtc(startAt, sub.plan.intervalUnit, sub.plan.intervalCount);

    const curStart = normalizeDate(sub.currentPeriodStartAt);
    const curEnd = normalizeDate(sub.currentPeriodEndAt);
    const nextStart = normalizeDate(startAt);
    const nextEnd = normalizeDate(endAt);

    if (nextEnd && (curStart !== nextStart || curEnd !== nextEnd)) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodStartAt: startAt,
          currentPeriodEndAt: endAt
        }
      });
      updated += 1;
    }

    const collectionMode = String((sub.plan.metadata as any)?.collectionMode || "");
    if (collectionMode === "AUTO_LINK" || collectionMode === "AUTO_DEBIT") {
      const existing = await prisma.retryJob.findFirst({
        where: {
          type: RetryJobType.PAYMENT_RETRY,
          status: RetryJobStatus.PENDING,
          payload: { path: ["subscriptionId"], equals: sub.id } as any
        }
      });
      if (!existing && nextEnd) {
        const runAt = nextEnd <= now + 5000 ? new Date() : new Date(nextEnd);
        await prisma.retryJob.create({
          data: {
            type: RetryJobType.PAYMENT_RETRY,
            runAt,
            maxAttempts: 1,
            payload: { subscriptionId: sub.id }
          }
        });
        scheduled += 1;
      }
    }
  }

  console.log(`Recalc done. Updated: ${updated}. Jobs scheduled: ${scheduled}.`);
}

main()
  .catch((err) => {
    console.error("Recalc failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
