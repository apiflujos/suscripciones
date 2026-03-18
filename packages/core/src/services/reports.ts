import { prisma } from "../db/prisma";
import { getMetricsOverview } from "./metrics";
import { WebhookProcessStatus, RetryJobStatus, LogLevel, MessageStatus } from "@prisma/client";

type Granularity = "day" | "week" | "month";

type BucketRow = { bucket: Date };

function granularityConfig(g: Granularity) {
  if (g === "day") return { trunc: "day", step: "1 day" } as const;
  if (g === "week") return { trunc: "week", step: "1 week" } as const;
  return { trunc: "month", step: "1 month" } as const;
}

function iso(d: Date) {
  return d.toISOString();
}

function num(v: any) {
  const n = typeof v === "bigint" ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function getCommerceReport(args: { from: Date; to: Date; granularity: Granularity; tenantId?: string | null }) {
  const metrics = await getMetricsOverview(args);
  const totalOk = Number(metrics.totals.totalPaymentsSuccessful || 0);
  const totalFail = Number(metrics.totals.totalPaymentsFailed || 0);
  const totalPayments = totalOk + totalFail;
  const approvalRate = totalPayments > 0 ? (totalOk / totalPayments) * 100 : 0;
  const avgTicket = totalOk > 0 ? Math.round(Number(metrics.totals.totalRevenueInCents || 0) / totalOk) : 0;

  return {
    range: metrics.range,
    totals: {
      ...metrics.totals,
      approvalRatePct: approvalRate,
      avgTicketInCents: avgTicket
    },
    breakdown: metrics.breakdown,
    meta: metrics.meta,
    series: metrics.series
  };
}

export async function getOperationsReport(args: { from: Date; to: Date; granularity: Granularity; tenantId?: string | null }) {
  const { trunc, step } = granularityConfig(args.granularity);
  const tenantId = String(args.tenantId || "").trim();
  const hasTenant = Boolean(tenantId);
  const tenantFilter = (alias: string, idx: number) => (hasTenant ? ` AND ${alias}."tenantId" = $${idx}::uuid` : "");
  const tenantArgs = hasTenant ? [tenantId] : [];

  const buckets = (await prisma.$queryRawUnsafe<BucketRow[]>(
    `SELECT bucket::timestamptz AS bucket
     FROM generate_series(date_trunc('${trunc}', $1::timestamptz), date_trunc('${trunc}', $2::timestamptz), interval '${step}') AS bucket
     ORDER BY bucket ASC`,
    args.from,
    args.to
  )) as BucketRow[];

  const series = new Map<string, { at: string; webhooks: any; jobs: any; logs: any }>();
  for (const b of buckets) {
    series.set(iso(b.bucket), {
      at: iso(b.bucket),
      webhooks: { total: 0, processed: 0, failed: 0, skipped: 0 },
      jobs: { created: 0, failed: 0, succeeded: 0, pending: 0, running: 0 },
      logs: { info: 0, warn: 0, error: 0 }
    });
  }

  const webhooksAgg = await prisma.$queryRawUnsafe<
    Array<{ bucket: Date; total: bigint; processed: bigint; failed: bigint; skipped: bigint }>
  >(
    `SELECT date_trunc('${trunc}', w."receivedAt") AS bucket,
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE w."processStatus" = 'PROCESSED')::bigint AS processed,
            COUNT(*) FILTER (WHERE w."processStatus" = 'FAILED')::bigint AS failed,
            COUNT(*) FILTER (WHERE w."processStatus" = 'SKIPPED')::bigint AS skipped
     FROM "WebhookEvent" w
     WHERE w."receivedAt" >= $1::timestamptz
       AND w."receivedAt" < $2::timestamptz
       ${tenantFilter("w", 3)}
     GROUP BY 1
     ORDER BY 1 ASC`,
    args.from,
    args.to,
    ...tenantArgs
  );

  for (const r of webhooksAgg) {
    const p = series.get(iso(r.bucket));
    if (!p) continue;
    p.webhooks.total = num(r.total);
    p.webhooks.processed = num(r.processed);
    p.webhooks.failed = num(r.failed);
    p.webhooks.skipped = num(r.skipped);
  }

  const jobsAgg = await prisma.$queryRawUnsafe<
    Array<{ bucket: Date; total: bigint; failed: bigint; succeeded: bigint; pending: bigint; running: bigint }>
  >(
    `SELECT date_trunc('${trunc}', j."createdAt") AS bucket,
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE j."status" = 'FAILED')::bigint AS failed,
            COUNT(*) FILTER (WHERE j."status" = 'SUCCEEDED')::bigint AS succeeded,
            COUNT(*) FILTER (WHERE j."status" = 'PENDING')::bigint AS pending,
            COUNT(*) FILTER (WHERE j."status" = 'RUNNING')::bigint AS running
     FROM "RetryJob" j
     WHERE j."createdAt" >= $1::timestamptz
       AND j."createdAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    args.from,
    args.to
  );

  for (const r of jobsAgg) {
    const p = series.get(iso(r.bucket));
    if (!p) continue;
    p.jobs.created = num(r.total);
    p.jobs.failed = num(r.failed);
    p.jobs.succeeded = num(r.succeeded);
    p.jobs.pending = num(r.pending);
    p.jobs.running = num(r.running);
  }

  const logsAgg = await prisma.$queryRawUnsafe<
    Array<{ bucket: Date; info: bigint; warn: bigint; error: bigint }>
  >(
    `SELECT date_trunc('${trunc}', l."createdAt") AS bucket,
            COUNT(*) FILTER (WHERE l."level" = 'INFO')::bigint AS info,
            COUNT(*) FILTER (WHERE l."level" = 'WARN')::bigint AS warn,
            COUNT(*) FILTER (WHERE l."level" = 'ERROR')::bigint AS error
     FROM "SystemLog" l
     WHERE l."createdAt" >= $1::timestamptz
       AND l."createdAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    args.from,
    args.to
  );

  for (const r of logsAgg) {
    const p = series.get(iso(r.bucket));
    if (!p) continue;
    p.logs.info = num(r.info);
    p.logs.warn = num(r.warn);
    p.logs.error = num(r.error);
  }

  const totalsWebhooks = await prisma.webhookEvent.groupBy({
    by: ["processStatus"],
    _count: { _all: true },
    where: {
      receivedAt: { gte: args.from, lt: args.to },
      ...(hasTenant ? { tenantId } : {})
    }
  });
  const totalsJobs = await prisma.retryJob.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: { createdAt: { gte: args.from, lt: args.to } }
  });
  const totalsLogs = await prisma.systemLog.groupBy({
    by: ["level"],
    _count: { _all: true },
    where: { createdAt: { gte: args.from, lt: args.to } }
  });

  const totalsWebhookMap = Object.fromEntries(totalsWebhooks.map((r) => [r.processStatus, r._count._all]));
  const totalsJobsMap = Object.fromEntries(totalsJobs.map((r) => [r.status, r._count._all]));
  const totalsLogsMap = Object.fromEntries(totalsLogs.map((r) => [r.level, r._count._all]));

  return {
    range: { from: iso(args.from), to: iso(args.to), granularity: args.granularity },
    totals: {
      webhooks: {
        total: num((totalsWebhookMap[WebhookProcessStatus.RECEIVED] || 0) + (totalsWebhookMap[WebhookProcessStatus.PROCESSED] || 0) + (totalsWebhookMap[WebhookProcessStatus.FAILED] || 0) + (totalsWebhookMap[WebhookProcessStatus.SKIPPED] || 0)),
        processed: num(totalsWebhookMap[WebhookProcessStatus.PROCESSED] || 0),
        failed: num(totalsWebhookMap[WebhookProcessStatus.FAILED] || 0),
        skipped: num(totalsWebhookMap[WebhookProcessStatus.SKIPPED] || 0)
      },
      jobs: {
        pending: num(totalsJobsMap[RetryJobStatus.PENDING] || 0),
        running: num(totalsJobsMap[RetryJobStatus.RUNNING] || 0),
        failed: num(totalsJobsMap[RetryJobStatus.FAILED] || 0),
        succeeded: num(totalsJobsMap[RetryJobStatus.SUCCEEDED] || 0),
        canceled: num(totalsJobsMap[RetryJobStatus.CANCELED] || 0)
      },
      logs: {
        info: num(totalsLogsMap[LogLevel.INFO] || 0),
        warn: num(totalsLogsMap[LogLevel.WARN] || 0),
        error: num(totalsLogsMap[LogLevel.ERROR] || 0)
      }
    },
    series: Array.from(series.values())
  };
}

export async function getChatwootReport(args: { from: Date; to: Date; granularity: Granularity; tenantId?: string | null }) {
  const { trunc, step } = granularityConfig(args.granularity);
  const tenantId = String(args.tenantId || "").trim();
  const hasTenant = Boolean(tenantId);
  const tenantFilter = (alias: string, idx: number) => (hasTenant ? ` AND ${alias}."tenantId" = $${idx}::uuid` : "");
  const tenantArgs = hasTenant ? [tenantId] : [];

  const buckets = (await prisma.$queryRawUnsafe<BucketRow[]>(
    `SELECT bucket::timestamptz AS bucket
     FROM generate_series(date_trunc('${trunc}', $1::timestamptz), date_trunc('${trunc}', $2::timestamptz), interval '${step}') AS bucket
     ORDER BY bucket ASC`,
    args.from,
    args.to
  )) as BucketRow[];

  const series = new Map<string, { at: string; sent: number; failed: number; pending: number }>();
  for (const b of buckets) {
    series.set(iso(b.bucket), { at: iso(b.bucket), sent: 0, failed: 0, pending: 0 });
  }

  const msgAgg = await prisma.$queryRawUnsafe<
    Array<{ bucket: Date; sent: bigint; failed: bigint; pending: bigint }>
  >(
    `SELECT date_trunc('${trunc}', m."createdAt") AS bucket,
            COUNT(*) FILTER (WHERE m."status" = 'SENT')::bigint AS sent,
            COUNT(*) FILTER (WHERE m."status" = 'FAILED')::bigint AS failed,
            COUNT(*) FILTER (WHERE m."status" = 'PENDING')::bigint AS pending
     FROM "ChatwootMessage" m
     WHERE m."createdAt" >= $1::timestamptz
       AND m."createdAt" < $2::timestamptz
       ${tenantFilter("m", 3)}
     GROUP BY 1
     ORDER BY 1 ASC`,
    args.from,
    args.to,
    ...tenantArgs
  );

  for (const r of msgAgg) {
    const p = series.get(iso(r.bucket));
    if (!p) continue;
    p.sent = num(r.sent);
    p.failed = num(r.failed);
    p.pending = num(r.pending);
  }

  const totals = await prisma.chatwootMessage.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: {
      createdAt: { gte: args.from, lt: args.to },
      ...(hasTenant ? { tenantId } : {})
    }
  });
  const totalsMap = Object.fromEntries(totals.map((r) => [r.status, r._count._all]));

  return {
    range: { from: iso(args.from), to: iso(args.to), granularity: args.granularity },
    totals: {
      sent: num(totalsMap[MessageStatus.SENT] || 0),
      failed: num(totalsMap[MessageStatus.FAILED] || 0),
      pending: num(totalsMap[MessageStatus.PENDING] || 0)
    },
    series: Array.from(series.values())
  };
}
