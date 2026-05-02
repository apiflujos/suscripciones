import "server-only";

import { getOperationsReport, getChatwootReport } from "@suscripciones/core/services/reports";
import { coerceTenantId } from "@suscripciones/core/services/tenantContext";
import { defaultRange, normalizeCacheRange, parseQueryDate } from "../reports/_lib";
import { getReportCache, setReportCache } from "@suscripciones/core/services/reportCache";
import { logger } from "@suscripciones/core/lib/logger";

type ReportResult =
  | { ok: true; data: any; cache: "HIT" | "STALE" | "MISS" | "BYPASS" }
  | { ok: false; status: number; error: string; details?: any };

async function withCache(args: {
  reportKey: string;
  tenantId: string;
  from: Date;
  to: Date;
  granularity?: string;
  compute: () => Promise<any>;
}): Promise<ReportResult> {
  const ttlSeconds = 60;
  const staleSeconds = 300;
  const key = {
    reportKey: args.reportKey,
    tenantId: args.tenantId,
    from: args.from,
    to: args.to,
    granularity: args.granularity,
    version: "v1"
  };
  const cached = await getReportCache(key);
  if (cached.hit && !cached.stale) {
    return { ok: true, data: cached.payload, cache: "HIT" };
  }
  if (cached.hit && cached.stale) {
    setImmediate(async () => {
      try {
        const payload = await args.compute();
        await setReportCache(key, payload, ttlSeconds, staleSeconds);
      } catch (err) {
        logger.error({ reportKey: args.reportKey, err }, "[ReportsCache] Failed to refresh cache");
      }
    });
    return { ok: true, data: cached.payload, cache: "STALE" };
  }
  const payload = await args.compute();
  await setReportCache(key, payload, ttlSeconds, staleSeconds);
  return { ok: true, data: payload, cache: "MISS" };
}

export async function getOperationsReportCached(args: {
  from?: string | Date | null;
  to?: string | Date | null;
  granularity?: "day" | "week" | "month";
  tenantId?: string | null;
}): Promise<ReportResult> {
  const d = defaultRange();
  const from = args.from
    ? args.from instanceof Date
      ? args.from
      : parseQueryDate(args.from) || d.from
    : d.from;
  const to = args.to
    ? args.to instanceof Date
      ? args.to
      : parseQueryDate(args.to) || d.to
    : d.to;
  const hasExplicitRange = Boolean(args.from || args.to);
  const cacheRange = normalizeCacheRange(from, to, 60, hasExplicitRange);
  const tenantId = coerceTenantId(args.tenantId) ?? null;
  const granularity = args.granularity ?? "day";

  if (!tenantId) {
    const payload = await getOperationsReport({
      from: cacheRange.from,
      to: cacheRange.to,
      granularity,
      tenantId: null
    });
    return { ok: true, data: payload, cache: "BYPASS" };
  }

  return withCache({
    reportKey: "reports.operations",
    tenantId,
    from: cacheRange.from,
    to: cacheRange.to,
    granularity,
    compute: () =>
      getOperationsReport({
        from: cacheRange.from,
        to: cacheRange.to,
        granularity,
        tenantId
      })
  });
}

export async function getChatwootReportCached(args: {
  from?: string | Date | null;
  to?: string | Date | null;
  granularity?: "day" | "week" | "month";
  tenantId?: string | null;
}): Promise<ReportResult> {
  const d = defaultRange();
  const from = args.from
    ? args.from instanceof Date
      ? args.from
      : parseQueryDate(args.from) || d.from
    : d.from;
  const to = args.to
    ? args.to instanceof Date
      ? args.to
      : parseQueryDate(args.to) || d.to
    : d.to;
  const hasExplicitRange = Boolean(args.from || args.to);
  const cacheRange = normalizeCacheRange(from, to, 60, hasExplicitRange);
  const tenantId = coerceTenantId(args.tenantId) ?? null;
  const granularity = args.granularity ?? "day";

  if (!tenantId) {
    const payload = await getChatwootReport({
      from: cacheRange.from,
      to: cacheRange.to,
      granularity,
      tenantId: null
    });
    return { ok: true, data: payload, cache: "BYPASS" };
  }

  return withCache({
    reportKey: "reports.chatwoot",
    tenantId,
    from: cacheRange.from,
    to: cacheRange.to,
    granularity,
    compute: () =>
      getChatwootReport({
        from: cacheRange.from,
        to: cacheRange.to,
        granularity,
        tenantId
      })
  });
}
