import { prisma } from "../db/prisma";
import { ensureBillingCyclesForSubscription } from "../services/billingCycles";

async function main() {
  const subs = await prisma.subscription.findMany({
    include: {
      plan: {
        select: {
          intervalUnit: true,
          intervalCount: true
        }
      },
      _count: {
        select: {
          billingCycles: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  let processed = 0;
  let createdForEmpty = 0;

  for (const sub of subs) {
    const before = Number(sub._count?.billingCycles || 0);
    await ensureBillingCyclesForSubscription({
      id: sub.id,
      startAt: sub.startAt,
      currentCycle: sub.currentCycle,
      currentPeriodStartAt: sub.currentPeriodStartAt,
      currentPeriodEndAt: sub.currentPeriodEndAt,
      cycleStartDay: sub.cycleStartDay,
      paymentDay: sub.paymentDay,
      paymentTiming: sub.paymentTiming as any,
      graceDays: sub.graceDays,
      plan: {
        intervalUnit: sub.plan.intervalUnit,
        intervalCount: sub.plan.intervalCount
      }
    });
    processed += 1;
    if (before === 0) createdForEmpty += 1;
  }

  const rows = await prisma.subscription.findMany({
    select: {
      id: true,
      _count: { select: { billingCycles: true } }
    }
  });
  const withoutCycles = rows.filter((row) => Number(row._count?.billingCycles || 0) === 0).length;

  console.log(JSON.stringify({
    processed,
    touchedEmptySubscriptions: createdForEmpty,
    totalSubscriptions: rows.length,
    subscriptionsWithoutCycles: withoutCycles
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
