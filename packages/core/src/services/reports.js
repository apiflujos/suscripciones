"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommerceReport = getCommerceReport;
exports.getOperationsReport = getOperationsReport;
exports.getChatwootReport = getChatwootReport;
const prisma_1 = require("../db/prisma");
const metrics_1 = require("./metrics");
const client_1 = require("@prisma/client");
function granularityConfig(g) {
    if (g === "day")
        return { trunc: "day", step: "1 day" };
    if (g === "week")
        return { trunc: "week", step: "1 week" };
    return { trunc: "month", step: "1 month" };
}
function iso(d) {
    return d.toISOString();
}
function num(v) {
    const n = typeof v === "bigint" ? Number(v) : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}
async function getCommerceReport(args) {
    const metrics = await (0, metrics_1.getMetricsOverview)(args);
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
async function getOperationsReport(args) {
    const { trunc, step } = granularityConfig(args.granularity);
    const tenantId = String(args.tenantId || "").trim();
    const hasTenant = Boolean(tenantId);
    const tenantFilter = (alias, idx) => (hasTenant ? ` AND ${alias}."tenantId" = $${idx}::uuid` : "");
    const tenantArgs = hasTenant ? [tenantId] : [];
    const buckets = (await prisma_1.prisma.$queryRawUnsafe(`SELECT bucket::timestamptz AS bucket
     FROM generate_series(date_trunc('${trunc}', $1::timestamptz), date_trunc('${trunc}', $2::timestamptz), interval '${step}') AS bucket
     ORDER BY bucket ASC`, args.from, args.to));
    const series = new Map();
    for (const b of buckets) {
        series.set(iso(b.bucket), {
            at: iso(b.bucket),
            webhooks: { total: 0, processed: 0, failed: 0, skipped: 0 },
            jobs: { created: 0, failed: 0, succeeded: 0, pending: 0, running: 0 },
            logs: { info: 0, warn: 0, error: 0 }
        });
    }
    const webhooksAgg = await prisma_1.prisma.$queryRawUnsafe(`SELECT date_trunc('${trunc}', w."receivedAt") AS bucket,
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE w."processStatus" = 'PROCESSED')::bigint AS processed,
            COUNT(*) FILTER (WHERE w."processStatus" = 'FAILED')::bigint AS failed,
            COUNT(*) FILTER (WHERE w."processStatus" = 'SKIPPED')::bigint AS skipped
     FROM "WebhookEvent" w
     WHERE w."receivedAt" >= $1::timestamptz
       AND w."receivedAt" < $2::timestamptz
       ${tenantFilter("w", 3)}
     GROUP BY 1
     ORDER BY 1 ASC`, args.from, args.to, ...tenantArgs);
    for (const r of webhooksAgg) {
        const p = series.get(iso(r.bucket));
        if (!p)
            continue;
        p.webhooks.total = num(r.total);
        p.webhooks.processed = num(r.processed);
        p.webhooks.failed = num(r.failed);
        p.webhooks.skipped = num(r.skipped);
    }
    const jobsAgg = await prisma_1.prisma.$queryRawUnsafe(`SELECT date_trunc('${trunc}', j."createdAt") AS bucket,
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE j."status" = 'FAILED')::bigint AS failed,
            COUNT(*) FILTER (WHERE j."status" = 'SUCCEEDED')::bigint AS succeeded,
            COUNT(*) FILTER (WHERE j."status" = 'PENDING')::bigint AS pending,
            COUNT(*) FILTER (WHERE j."status" = 'RUNNING')::bigint AS running
     FROM "RetryJob" j
     WHERE j."createdAt" >= $1::timestamptz
       AND j."createdAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`, args.from, args.to);
    for (const r of jobsAgg) {
        const p = series.get(iso(r.bucket));
        if (!p)
            continue;
        p.jobs.created = num(r.total);
        p.jobs.failed = num(r.failed);
        p.jobs.succeeded = num(r.succeeded);
        p.jobs.pending = num(r.pending);
        p.jobs.running = num(r.running);
    }
    const logsAgg = await prisma_1.prisma.$queryRawUnsafe(`SELECT date_trunc('${trunc}', l."createdAt") AS bucket,
            COUNT(*) FILTER (WHERE l."level" = 'INFO')::bigint AS info,
            COUNT(*) FILTER (WHERE l."level" = 'WARN')::bigint AS warn,
            COUNT(*) FILTER (WHERE l."level" = 'ERROR')::bigint AS error
     FROM "SystemLog" l
     WHERE l."createdAt" >= $1::timestamptz
       AND l."createdAt" < $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`, args.from, args.to);
    for (const r of logsAgg) {
        const p = series.get(iso(r.bucket));
        if (!p)
            continue;
        p.logs.info = num(r.info);
        p.logs.warn = num(r.warn);
        p.logs.error = num(r.error);
    }
    const totalsWebhooks = await prisma_1.prisma.webhookEvent.groupBy({
        by: ["processStatus"],
        _count: { _all: true },
        where: {
            receivedAt: { gte: args.from, lt: args.to },
            ...(hasTenant ? { tenantId } : {})
        }
    });
    const totalsJobs = await prisma_1.prisma.retryJob.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { createdAt: { gte: args.from, lt: args.to } }
    });
    const totalsLogs = await prisma_1.prisma.systemLog.groupBy({
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
                total: num((totalsWebhookMap[client_1.WebhookProcessStatus.RECEIVED] || 0) + (totalsWebhookMap[client_1.WebhookProcessStatus.PROCESSED] || 0) + (totalsWebhookMap[client_1.WebhookProcessStatus.FAILED] || 0) + (totalsWebhookMap[client_1.WebhookProcessStatus.SKIPPED] || 0)),
                processed: num(totalsWebhookMap[client_1.WebhookProcessStatus.PROCESSED] || 0),
                failed: num(totalsWebhookMap[client_1.WebhookProcessStatus.FAILED] || 0),
                skipped: num(totalsWebhookMap[client_1.WebhookProcessStatus.SKIPPED] || 0)
            },
            jobs: {
                pending: num(totalsJobsMap[client_1.RetryJobStatus.PENDING] || 0),
                running: num(totalsJobsMap[client_1.RetryJobStatus.RUNNING] || 0),
                failed: num(totalsJobsMap[client_1.RetryJobStatus.FAILED] || 0),
                succeeded: num(totalsJobsMap[client_1.RetryJobStatus.SUCCEEDED] || 0),
                canceled: num(totalsJobsMap[client_1.RetryJobStatus.CANCELED] || 0)
            },
            logs: {
                info: num(totalsLogsMap[client_1.LogLevel.INFO] || 0),
                warn: num(totalsLogsMap[client_1.LogLevel.WARN] || 0),
                error: num(totalsLogsMap[client_1.LogLevel.ERROR] || 0)
            }
        },
        series: Array.from(series.values())
    };
}
async function getChatwootReport(args) {
    const { trunc, step } = granularityConfig(args.granularity);
    const tenantId = String(args.tenantId || "").trim();
    const hasTenant = Boolean(tenantId);
    const tenantFilter = (alias, idx) => (hasTenant ? ` AND ${alias}."tenantId" = $${idx}::uuid` : "");
    const tenantArgs = hasTenant ? [tenantId] : [];
    const buckets = (await prisma_1.prisma.$queryRawUnsafe(`SELECT bucket::timestamptz AS bucket
     FROM generate_series(date_trunc('${trunc}', $1::timestamptz), date_trunc('${trunc}', $2::timestamptz), interval '${step}') AS bucket
     ORDER BY bucket ASC`, args.from, args.to));
    const series = new Map();
    for (const b of buckets) {
        series.set(iso(b.bucket), { at: iso(b.bucket), sent: 0, failed: 0, pending: 0 });
    }
    const msgAgg = await prisma_1.prisma.$queryRawUnsafe(`SELECT date_trunc('${trunc}', m."createdAt") AS bucket,
            COUNT(*) FILTER (WHERE m."status" = 'SENT')::bigint AS sent,
            COUNT(*) FILTER (WHERE m."status" = 'FAILED')::bigint AS failed,
            COUNT(*) FILTER (WHERE m."status" = 'PENDING')::bigint AS pending
     FROM "ChatwootMessage" m
     WHERE m."createdAt" >= $1::timestamptz
       AND m."createdAt" < $2::timestamptz
       ${tenantFilter("m", 3)}
     GROUP BY 1
     ORDER BY 1 ASC`, args.from, args.to, ...tenantArgs);
    for (const r of msgAgg) {
        const p = series.get(iso(r.bucket));
        if (!p)
            continue;
        p.sent = num(r.sent);
        p.failed = num(r.failed);
        p.pending = num(r.pending);
    }
    const totals = await prisma_1.prisma.chatwootMessage.groupBy({
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
            sent: num(totalsMap[client_1.MessageStatus.SENT] || 0),
            failed: num(totalsMap[client_1.MessageStatus.FAILED] || 0),
            pending: num(totalsMap[client_1.MessageStatus.PENDING] || 0)
        },
        series: Array.from(series.values())
    };
}
