import { prisma } from "../db/prisma";
import { PaymentStatus, PlanIntervalUnit } from "@prisma/client";
import { addIntervalUtc } from "../lib/dates";

type Row = {
  subscriptionId: string;
  planName: string;
  intervalUnit: PlanIntervalUnit;
  intervalCount: number;
  previousPaidAt: Date;
  currentPaidAt: Date;
  expectedNextAt: Date;
  deltaHours: number;
};

function hoursBetween(a: Date, b: Date) {
  return Math.round(((b.getTime() - a.getTime()) / 36e5) * 100) / 100;
}

async function findEarlyApprovedCharges(limit: number) {
  const subs = await prisma.subscription.findMany({
    include: {
      plan: { select: { name: true, intervalUnit: true, intervalCount: true } },
      payments: {
        where: { status: PaymentStatus.APPROVED, paidAt: { not: null } },
        orderBy: { paidAt: "asc" },
        select: { id: true, paidAt: true, amountInCents: true, reference: true }
      }
    }
  });

  const suspicious: Row[] = [];
  for (const sub of subs) {
    if (!sub.plan || !Array.isArray(sub.payments) || sub.payments.length < 2) continue;
    for (let i = 1; i < sub.payments.length; i += 1) {
      const prev = sub.payments[i - 1];
      const cur = sub.payments[i];
      if (!prev.paidAt || !cur.paidAt) continue;
      const expected = addIntervalUtc(prev.paidAt, sub.plan.intervalUnit, sub.plan.intervalCount);
      if (cur.paidAt.getTime() + 5000 < expected.getTime()) {
        suspicious.push({
          subscriptionId: sub.id,
          planName: sub.plan.name,
          intervalUnit: sub.plan.intervalUnit,
          intervalCount: sub.plan.intervalCount,
          previousPaidAt: prev.paidAt,
          currentPaidAt: cur.paidAt,
          expectedNextAt: expected,
          deltaHours: hoursBetween(cur.paidAt, expected)
        });
      }
      if (suspicious.length >= limit) return suspicious;
    }
  }
  return suspicious;
}

async function findRecentPendingDuplicates(limit: number) {
  return prisma.$queryRaw<
    Array<{
      subscriptionId: string;
      pendingCount: bigint;
      firstPendingAt: Date;
      lastPendingAt: Date;
    }>
  >`
    SELECT
      p."subscriptionId" as "subscriptionId",
      COUNT(*)::bigint as "pendingCount",
      MIN(p."createdAt") as "firstPendingAt",
      MAX(p."createdAt") as "lastPendingAt"
    FROM "Payment" p
    WHERE p."subscriptionId" IS NOT NULL
      AND p."status" = 'PENDING'
      AND p."wompiTransactionId" IS NOT NULL
      AND p."createdAt" >= now() - interval '36 hours'
    GROUP BY p."subscriptionId"
    HAVING COUNT(*) > 1
    ORDER BY MAX(p."createdAt") DESC
    LIMIT ${limit};
  `;
}

async function findWebhookFallbackWithoutSubscription(limit: number) {
  return prisma.payment.findMany({
    where: {
      subscriptionId: null,
      providerResponse: { path: ["webhook"], not: undefined } as any,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      tenantId: true,
      reference: true,
      wompiTransactionId: true,
      wompiPaymentLinkId: true,
      status: true,
      createdAt: true,
      paidAt: true
    }
  });
}

async function main() {
  const limit = Number(process.env.AUDIT_LIMIT || 100);
  const safeLimit = Number.isFinite(limit) ? Math.max(10, Math.min(500, Math.trunc(limit))) : 100;

  const [earlyCharges, pendingDuplicates, fallbackPayments] = await Promise.all([
    findEarlyApprovedCharges(safeLimit),
    findRecentPendingDuplicates(safeLimit),
    findWebhookFallbackWithoutSubscription(safeLimit)
  ]);

  console.log("=== Audit billing integrity ===");
  console.log(`Early approved charges: ${earlyCharges.length}`);
  for (const row of earlyCharges.slice(0, 20)) {
    console.log(
      [
        row.subscriptionId,
        row.planName,
        `${row.intervalCount} ${row.intervalUnit}`,
        `prev=${row.previousPaidAt.toISOString()}`,
        `current=${row.currentPaidAt.toISOString()}`,
        `expected=${row.expectedNextAt.toISOString()}`,
        `aheadHours=${row.deltaHours}`
      ].join(" | ")
    );
  }

  console.log(`Pending duplicates (36h): ${pendingDuplicates.length}`);
  for (const row of pendingDuplicates.slice(0, 20)) {
    console.log(
      [
        row.subscriptionId,
        `count=${Number(row.pendingCount)}`,
        `first=${row.firstPendingAt.toISOString()}`,
        `last=${row.lastPendingAt.toISOString()}`
      ].join(" | ")
    );
  }

  console.log(`Webhook fallback payments without subscription (7d): ${fallbackPayments.length}`);
  for (const row of fallbackPayments.slice(0, 20)) {
    console.log(
      [
        row.id,
        row.status,
        row.reference,
        row.wompiTransactionId || "-",
        row.wompiPaymentLinkId || "-",
        row.createdAt.toISOString(),
        row.paidAt ? row.paidAt.toISOString() : "-"
      ].join(" | ")
    );
  }
}

main()
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

