import { prisma } from "../db/prisma";
import { PaymentStatus, PlanType, SubscriptionStatus } from "@prisma/client";

type Granularity = "day" | "week" | "month";

type BucketRow = { bucket: Date };

type SeriesPoint = {
  at: string;
  revenueInCents: number;
  paymentsSuccess: number;
  paymentsFailed: number;
  linksSent: number;
  linksPaid: number;
  activeSubscriptions: number;
  mrrInCents?: number;
  newAutoSubscriptions?: number;
  canceledAutoSubscriptions?: number;
  churnMonthlyPct?: number | null;
};

function granularityConfig(g: Granularity) {
  if (g === "day") return { trunc: "day", step: "1 day" } as const;
  if (g === "week") return { trunc: "week", step: "1 week" } as const;
  return { trunc: "month", step: "1 month" } as const;
}

function clampRange(from: Date, to: Date) {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    const toSafe = new Date();
    const fromSafe = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return { from: fromSafe, to: toSafe };
  }
  if (t <= f) {
    const toSafe = new Date(f.getTime() + 24 * 60 * 60 * 1000);
    return { from: f, to: toSafe };
  }
  return { from: f, to: t };
}

function iso(d: Date) {
  return d.toISOString();
}

function num(v: any) {
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED];
function monthBoundsUtc(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

export async function getMetricsOverview(args: { from: Date; to: Date; granularity: Granularity }) {
  const { from, to } = clampRange(args.from, args.to);
  const { trunc, step } = granularityConfig(args.granularity);

  const buckets = (await prisma.$queryRawUnsafe<BucketRow[]>(
    `SELECT bucket::timestamptz AS bucket
     FROM generate_series(date_trunc('${trunc}', $1::timestamptz), date_trunc('${trunc}', $2::timestamptz), interval '${step}') AS bucket
     ORDER BY bucket ASC`,
    from,
    to
  )) as BucketRow[];

  const baseSeries = new Map<string, SeriesPoint>();
  for (const b of buckets) {
    baseSeries.set(iso(b.bucket), {
      at: iso(b.bucket),
      revenueInCents: 0,
      paymentsSuccess: 0,
      paymentsFailed: 0,
      linksSent: 0,
      linksPaid: 0,
      activeSubscriptions: 0
    });
  }

  const paymentsAgg = await prisma.$queryRawUnsafe<
    Array<{ bucket: Date; payments_success: bigint; revenue_cents: bigint }>
  >(
    `SELECT date_trunc('${trunc}', p."paidAt") AS bucket,
            COUNT(*)::bigint AS payments_success,
            COALESCE(SUM(p."amountInCents"), 0)::bigint AS revenue_cents
     FROM "Payment" p
     WHERE p."status" = 'APPROVED'
       AND p."paidAt" IS NOT NULL
       AND p."paidAt" >= $1::timestamptz
       AND p."paidAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    from,
    to
  );

  for (const r of paymentsAgg) {
    const key = iso(r.bucket);
    const p = baseSeries.get(key);
    if (!p) continue;
    p.paymentsSuccess = num(r.payments_success);
    p.revenueInCents = num(r.revenue_cents);
  }

  const failedAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; payments_failed: bigint }>>(
    `SELECT date_trunc('${trunc}', COALESCE(p."failedAt", p."updatedAt")) AS bucket,
            COUNT(*)::bigint AS payments_failed
     FROM "Payment" p
     WHERE p."status" IN ('DECLINED', 'ERROR', 'VOIDED')
       AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz
       AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    from,
    to
  );

  for (const r of failedAgg) {
    const key = iso(r.bucket);
    const p = baseSeries.get(key);
    if (!p) continue;
    p.paymentsFailed = num(r.payments_failed);
  }

  const linksSentAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; links_sent: bigint }>>(
    `SELECT date_trunc('${trunc}', pl."sentAt") AS bucket,
            COUNT(*)::bigint AS links_sent
     FROM "PaymentLink" pl
     JOIN "SubscriptionPlan" sp ON sp."id" = pl."planId"
     WHERE sp."planType" = 'manual_link'
       AND pl."sentAt" >= $1::timestamptz
       AND pl."sentAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    from,
    to
  );

  for (const r of linksSentAgg) {
    const key = iso(r.bucket);
    const p = baseSeries.get(key);
    if (!p) continue;
    p.linksSent = num(r.links_sent);
  }

  const linksPaidAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; links_paid: bigint }>>(
    `SELECT date_trunc('${trunc}', pl."paidAt") AS bucket,
            COUNT(*)::bigint AS links_paid
     FROM "PaymentLink" pl
     JOIN "SubscriptionPlan" sp ON sp."id" = pl."planId"
     WHERE sp."planType" = 'manual_link'
       AND pl."paidAt" IS NOT NULL
       AND pl."paidAt" >= $1::timestamptz
       AND pl."paidAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    from,
    to
  );

  for (const r of linksPaidAgg) {
    const key = iso(r.bucket);
    const p = baseSeries.get(key);
    if (!p) continue;
    p.linksPaid = num(r.links_paid);
  }

  // Active subscriptions (cumulative from start/cancel events).
  const firstBucket = buckets[0]?.bucket ?? from;
  const initialActiveRow = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c
     FROM "Subscription" s
     WHERE s."status" IN ('ACTIVE', 'PAST_DUE', 'SUSPENDED')
       AND s."startAt" < $1::timestamptz
       AND (s."canceledAt" IS NULL OR s."canceledAt" >= $1::timestamptz)`,
    firstBucket
  );
  let activeSoFar = num(initialActiveRow[0]?.c ?? 0);

  const startsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; starts: bigint }>>(
    `SELECT date_trunc('${trunc}', s."startAt") AS bucket,
            COUNT(*)::bigint AS starts
     FROM "Subscription" s
     WHERE s."startAt" >= $1::timestamptz
       AND s."startAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    from,
    to
  );

  const cancelsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; cancels: bigint }>>(
    `SELECT date_trunc('${trunc}', s."canceledAt") AS bucket,
            COUNT(*)::bigint AS cancels
     FROM "Subscription" s
     WHERE s."canceledAt" IS NOT NULL
       AND s."canceledAt" >= $1::timestamptz
       AND s."canceledAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    from,
    to
  );

  const startsByBucket = new Map<string, number>();
  for (const r of startsAgg) startsByBucket.set(iso(r.bucket), num(r.starts));
  const cancelsByBucket = new Map<string, number>();
  for (const r of cancelsAgg) cancelsByBucket.set(iso(r.bucket), num(r.cancels));

  for (const b of buckets) {
    const key = iso(b.bucket);
    activeSoFar += startsByBucket.get(key) ?? 0;
    activeSoFar -= cancelsByBucket.get(key) ?? 0;
    const p = baseSeries.get(key);
    if (p) p.activeSubscriptions = Math.max(0, activeSoFar);
  }

  // Totals (range + snapshots)
  const totalsPaymentsRow = await prisma.$queryRawUnsafe<
    Array<{ payments_success: bigint; payments_failed: bigint; revenue_cents: bigint }>
  >(
    `SELECT
        COUNT(*) FILTER (WHERE p."status" = 'APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)::bigint AS payments_success,
        COUNT(*) FILTER (WHERE p."status" IN ('DECLINED','ERROR','VOIDED') AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)::bigint AS payments_failed,
        COALESCE(SUM(p."amountInCents") FILTER (WHERE p."status" = 'APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz), 0)::bigint AS revenue_cents
      FROM "Payment" p`,
    from,
    to
  );

  const totalsPlansSoldRow = await prisma.$queryRawUnsafe<Array<{ plans_sold: bigint }>>(
    `WITH first_paid AS (
       SELECT p."subscriptionId", MIN(p."paidAt") AS first_paid_at
       FROM "Payment" p
       WHERE p."subscriptionId" IS NOT NULL
         AND p."status" = 'APPROVED'
         AND p."paidAt" IS NOT NULL
       GROUP BY p."subscriptionId"
     )
     SELECT COUNT(*)::bigint AS plans_sold
     FROM first_paid
     WHERE first_paid_at >= $1::timestamptz AND first_paid_at < $2::timestamptz`,
    from,
    to
  );

  const activeSubsRow = await prisma.subscription.count({
    where: { status: { in: ACTIVE_SUBSCRIPTION_STATUSES } }
  });

  const linksTotalsRow = await prisma.$queryRawUnsafe<
    Array<{ links_sent: bigint; links_paid_any: bigint; links_paid_in_range: bigint; link_revenue_cents: bigint; avg_time_to_pay_sec: number | null }>
  >(
    `WITH sent_in_range AS (
       SELECT pl.*
       FROM "PaymentLink" pl
       JOIN "SubscriptionPlan" sp ON sp."id" = pl."planId"
       WHERE sp."planType" = 'manual_link'
         AND pl."sentAt" >= $1::timestamptz
         AND pl."sentAt" < $2::timestamptz
     )
     SELECT
       COUNT(*)::bigint AS links_sent,
       COUNT(*) FILTER (WHERE "paidAt" IS NOT NULL)::bigint AS links_paid_any,
       COUNT(*) FILTER (WHERE "paidAt" IS NOT NULL AND "paidAt" >= $1::timestamptz AND "paidAt" < $2::timestamptz)::bigint AS links_paid_in_range,
       COALESCE(SUM(p."amountInCents") FILTER (WHERE p."status"='APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz), 0)::bigint AS link_revenue_cents,
       AVG(EXTRACT(EPOCH FROM ("paidAt" - "sentAt"))) FILTER (WHERE "paidAt" IS NOT NULL AND "paidAt" >= "sentAt") AS avg_time_to_pay_sec
     FROM sent_in_range pl
     LEFT JOIN "Payment" p ON p."id" = pl."paymentId"`,
    from,
    to
  );

  const autoSubsSnapshot = await prisma.subscription.count({
    where: { status: { in: ACTIVE_SUBSCRIPTION_STATUSES }, plan: { planType: PlanType.auto_subscription } }
  });

  const newAutoSubsRow = await prisma.subscription.count({
    where: { plan: { planType: PlanType.auto_subscription }, createdAt: { gte: from, lt: to } }
  });

  const canceledAutoSubsRow = await prisma.subscription.count({
    where: { plan: { planType: PlanType.auto_subscription }, canceledAt: { gte: from, lt: to } }
  });

  const autoChargesRow = await prisma.$queryRawUnsafe<Array<{ ok: bigint; failed: bigint }>>(
    `SELECT
        COUNT(*) FILTER (WHERE p."status"='APPROVED' AND p."paidAt" IS NOT NULL AND p."paidAt" >= $1::timestamptz AND p."paidAt" < $2::timestamptz)::bigint AS ok,
        COUNT(*) FILTER (WHERE p."status" IN ('DECLINED','ERROR','VOIDED') AND COALESCE(p."failedAt", p."updatedAt") >= $1::timestamptz AND COALESCE(p."failedAt", p."updatedAt") < $2::timestamptz)::bigint AS failed
      FROM "Payment" p
      JOIN "Subscription" s ON s."id" = p."subscriptionId"
      JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
      WHERE sp."planType" = 'auto_subscription'
        AND p."wompiTransactionId" IS NOT NULL`,
    from,
    to
  );

  const mrrRow = await prisma.$queryRawUnsafe<Array<{ mrr_cents: number | null }>>(
    `SELECT
        COALESCE(SUM(ROUND(
          sp."priceInCents"::numeric *
          CASE sp."intervalUnit"
            WHEN 'MONTH' THEN (1::numeric / GREATEST(sp."intervalCount", 1))
            WHEN 'WEEK' THEN (4.34524::numeric / GREATEST(sp."intervalCount", 1))
            WHEN 'DAY' THEN (30.4375::numeric / GREATEST(sp."intervalCount", 1))
            ELSE 0::numeric
          END
        )), 0)::numeric AS mrr_cents
      FROM "Subscription" s
      JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
      WHERE sp."planType" = 'auto_subscription'
        AND s."status" IN ('ACTIVE','PAST_DUE','SUSPENDED')`
  );

  const { start: churnStart, end: churnEnd } = monthBoundsUtc(new Date(to.getTime() - 1));
  const churnRow = await prisma.$queryRawUnsafe<Array<{ cancels: bigint; active_start: bigint }>>(
    `SELECT
        COUNT(*) FILTER (WHERE s."canceledAt" IS NOT NULL AND s."canceledAt" >= $1::timestamptz AND s."canceledAt" < $2::timestamptz)::bigint AS cancels,
        COUNT(*) FILTER (
          WHERE s."startAt" < $1::timestamptz
            AND (s."canceledAt" IS NULL OR s."canceledAt" >= $1::timestamptz)
        )::bigint AS active_start
      FROM "Subscription" s
      JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
      WHERE sp."planType" = 'auto_subscription'`,
    churnStart,
    churnEnd
  );

  const cancels = num(churnRow[0]?.cancels ?? 0);
  const activeStart = num(churnRow[0]?.active_start ?? 0);
  const churnMonthlyPct = activeStart > 0 ? (cancels / activeStart) * 100 : null;

  const revenueByPlanType = await prisma.$queryRawUnsafe<Array<{ plan_type: PlanType; revenue_cents: bigint }>>(
    `SELECT sp."planType" AS plan_type,
            COALESCE(SUM(p."amountInCents"), 0)::bigint AS revenue_cents
     FROM "Payment" p
     JOIN "Subscription" s ON s."id" = p."subscriptionId"
     JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
     WHERE p."status"='APPROVED'
       AND p."paidAt" IS NOT NULL
       AND p."paidAt" >= $1::timestamptz
       AND p."paidAt" < $2::timestamptz
     GROUP BY 1`,
    from,
    to
  );
  const revenueByPlanTypeInCents: Record<string, number> = { manual_link: 0, auto_subscription: 0 };
  for (const r of revenueByPlanType) revenueByPlanTypeInCents[String(r.plan_type)] = num(r.revenue_cents);

  // Optional: month-only series for auto subs MRR + churn.
  if (args.granularity === "month" && buckets.length) {
    const initialMrrRow = await prisma.$queryRawUnsafe<Array<{ v: number | null }>>(
      `SELECT
          COALESCE(SUM(ROUND(
            sp."priceInCents"::numeric *
            CASE sp."intervalUnit"
              WHEN 'MONTH' THEN (1::numeric / GREATEST(sp."intervalCount", 1))
              WHEN 'WEEK' THEN (4.34524::numeric / GREATEST(sp."intervalCount", 1))
              WHEN 'DAY' THEN (30.4375::numeric / GREATEST(sp."intervalCount", 1))
              ELSE 0::numeric
            END
          )), 0)::numeric AS v
        FROM "Subscription" s
        JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
        WHERE sp."planType" = 'auto_subscription'
          AND s."status" IN ('ACTIVE','PAST_DUE','SUSPENDED')
          AND s."startAt" < $1::timestamptz
          AND (s."canceledAt" IS NULL OR s."canceledAt" >= $1::timestamptz)`,
      firstBucket
    );
    let mrrSoFar = Math.round(num(initialMrrRow[0]?.v ?? 0));

    const mrrStartsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; adds: number | null }>>(
      `SELECT date_trunc('${trunc}', s."startAt") AS bucket,
              COALESCE(SUM(ROUND(
                sp."priceInCents"::numeric *
                CASE sp."intervalUnit"
                  WHEN 'MONTH' THEN (1::numeric / GREATEST(sp."intervalCount", 1))
                  WHEN 'WEEK' THEN (4.34524::numeric / GREATEST(sp."intervalCount", 1))
                  WHEN 'DAY' THEN (30.4375::numeric / GREATEST(sp."intervalCount", 1))
                  ELSE 0::numeric
                END
              )), 0)::numeric AS adds
        FROM "Subscription" s
        JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
        WHERE sp."planType" = 'auto_subscription'
          AND s."startAt" >= $1::timestamptz
          AND s."startAt" < $2::timestamptz
        GROUP BY 1
        ORDER BY 1 ASC`,
      from,
      to
    );

    const mrrCancelsAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; subs: number | null }>>(
      `SELECT date_trunc('${trunc}', s."canceledAt") AS bucket,
              COALESCE(SUM(ROUND(
                sp."priceInCents"::numeric *
                CASE sp."intervalUnit"
                  WHEN 'MONTH' THEN (1::numeric / GREATEST(sp."intervalCount", 1))
                  WHEN 'WEEK' THEN (4.34524::numeric / GREATEST(sp."intervalCount", 1))
                  WHEN 'DAY' THEN (30.4375::numeric / GREATEST(sp."intervalCount", 1))
                  ELSE 0::numeric
                END
              )), 0)::numeric AS subs
        FROM "Subscription" s
        JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
        WHERE sp."planType" = 'auto_subscription'
          AND s."canceledAt" IS NOT NULL
          AND s."canceledAt" >= $1::timestamptz
          AND s."canceledAt" < $2::timestamptz
        GROUP BY 1
        ORDER BY 1 ASC`,
      from,
      to
    );

    const mrrAddsByBucket = new Map<string, number>();
    for (const r of mrrStartsAgg) mrrAddsByBucket.set(iso(r.bucket), Math.round(num(r.adds ?? 0)));
    const mrrSubsByBucket = new Map<string, number>();
    for (const r of mrrCancelsAgg) mrrSubsByBucket.set(iso(r.bucket), Math.round(num(r.subs ?? 0)));

    for (const b of buckets) {
      const key = iso(b.bucket);
      mrrSoFar += mrrAddsByBucket.get(key) ?? 0;
      mrrSoFar -= mrrSubsByBucket.get(key) ?? 0;
      const p = baseSeries.get(key);
      if (p) p.mrrInCents = Math.max(0, mrrSoFar);
    }

    const churnAgg = await prisma.$queryRawUnsafe<Array<{ bucket: Date; cancels: bigint; active_start: bigint }>>(
      `WITH months AS (
         SELECT bucket::timestamptz AS bucket
         FROM generate_series(date_trunc('month', $1::timestamptz), date_trunc('month', $2::timestamptz), interval '1 month') AS bucket
       )
       SELECT
         m.bucket AS bucket,
         (
           SELECT COUNT(*)::bigint
           FROM "Subscription" s
           JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
           WHERE sp."planType"='auto_subscription'
             AND s."canceledAt" IS NOT NULL
             AND s."canceledAt" >= m.bucket
             AND s."canceledAt" < (m.bucket + interval '1 month')
         ) AS cancels,
         (
           SELECT COUNT(*)::bigint
           FROM "Subscription" s
           JOIN "SubscriptionPlan" sp ON sp."id" = s."planId"
           WHERE sp."planType"='auto_subscription'
             AND s."startAt" < m.bucket
             AND (s."canceledAt" IS NULL OR s."canceledAt" >= m.bucket)
         ) AS active_start
       FROM months m
       ORDER BY m.bucket ASC`,
      from,
      to
    );

    for (const r of churnAgg) {
      const key = iso(r.bucket);
      const p = baseSeries.get(key);
      if (!p) continue;
      const c = num(r.cancels);
      const a = num(r.active_start);
      p.churnMonthlyPct = a > 0 ? (c / a) * 100 : null;
    }
  }

  const series = Array.from(baseSeries.values()).sort((a, b) => a.at.localeCompare(b.at));
  return {
    range: { from: iso(from), to: iso(to), granularity: args.granularity },
    totals: {
      totalPlansSold: num(totalsPlansSoldRow[0]?.plans_sold ?? 0),
      totalActiveSubscriptions: activeSubsRow,
      totalPaymentsSuccessful: num(totalsPaymentsRow[0]?.payments_success ?? 0),
      totalPaymentsFailed: num(totalsPaymentsRow[0]?.payments_failed ?? 0),
      totalRevenueInCents: num(totalsPaymentsRow[0]?.revenue_cents ?? 0),
      link: {
        linksSent: num(linksTotalsRow[0]?.links_sent ?? 0),
        linksPaid: num(linksTotalsRow[0]?.links_paid_in_range ?? 0),
        conversionLinkToPayPct: num(linksTotalsRow[0]?.links_sent ?? 0) > 0 ? (num(linksTotalsRow[0]?.links_paid_any ?? 0) / num(linksTotalsRow[0]?.links_sent ?? 0)) * 100 : 0,
        revenueInCents: num(linksTotalsRow[0]?.link_revenue_cents ?? 0),
        avgTimeToPaySec: linksTotalsRow[0]?.avg_time_to_pay_sec == null ? null : Number(linksTotalsRow[0]?.avg_time_to_pay_sec)
      },
      auto: {
        activeSubscriptions: autoSubsSnapshot,
        newSubscriptions: newAutoSubsRow,
        cancellations: canceledAutoSubsRow,
        autoChargesSuccessful: num(autoChargesRow[0]?.ok ?? 0),
        autoChargesFailed: num(autoChargesRow[0]?.failed ?? 0),
        mrrInCents: Math.round(num(mrrRow[0]?.mrr_cents ?? 0)),
        churnMonthlyPct
      }
    },
    breakdown: {
      revenueByPlanTypeInCents
    },
    series
  };
}
