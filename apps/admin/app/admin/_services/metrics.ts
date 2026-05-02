import "server-only";

import { z } from "zod";
import { getMetricsOverview } from "@suscripciones/core/services/metrics";
import { getReportCache, setReportCache } from "@suscripciones/core/services/reportCache";
import { coerceTenantId } from "@suscripciones/core/services/tenantContext";
import { logger } from "@suscripciones/core/lib/logger";

export const metricsQuerySchema = z
  .object({
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    granularity: z.enum(["day", "week", "month"]).optional().default("day"),
    tenantId: z.string().uuid().optional().nullable()
  })
  .refine(
    (data) => {
      const from = data.from ? parseQueryDate(data.from) : null;
      const to = data.to ? parseQueryDate(data.to) : null;
      if (data.from && !from) return false;
      if (data.to && !to) return false;
      if (from && to) {
        const days = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
        return days <= 365 && days >= 0;
      }
      return true;
    },
    { message: "El rango de fechas no puede exceder 365 días y debe ser válido" }
  );

export function parseQueryDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

async function refreshCache(cacheKey: any, data: any, cacheTtlSeconds: number, staleSeconds: number) {
  try {
    await setReportCache(cacheKey, data, cacheTtlSeconds, staleSeconds);
    logger.info({ key: cacheKey.reportKey, tenantId: cacheKey.tenantId }, "[MetricsCache] Updated cache");
  } catch (err) {
    logger.error({
      key: cacheKey.reportKey,
      tenantId: cacheKey.tenantId,
      err
    }, "[MetricsCache] Failed to update cache");
  }
}

type MetricsResult =
  | { ok: true; data: any; cache: "HIT" | "STALE" | "MISS" | "BYPASS" }
  | { ok: false; status: number; error: string; message?: string; details?: any };

export async function getMetricsOverviewCached(args: {
  from?: string | Date | null;
  to?: string | Date | null;
  granularity?: "day" | "week" | "month";
  tenantId?: string | null;
}): Promise<MetricsResult> {
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
  const cacheTtlSeconds = 300;
  const staleSeconds = 900;
  const granularity = args.granularity ?? "day";

  const tenantId = coerceTenantId(args.tenantId) ?? null;

  let cacheFrom = from;
  let cacheTo = to;
  if (!hasExplicitRange) {
    const bucketMs = cacheTtlSeconds * 1000;
    const alignedTo = new Date(Math.floor(to.getTime() / bucketMs) * bucketMs);
    const rangeMs = Math.max(24 * 60 * 60 * 1000, to.getTime() - from.getTime());
    cacheTo = alignedTo;
    cacheFrom = new Date(cacheTo.getTime() - rangeMs);
  }

  if (!tenantId) {
    try {
      const data = await getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity, tenantId: null });
      return { ok: true, data, cache: "BYPASS" };
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: "error_consultando_metricas",
        message: err instanceof Error ? String(err.message) : "Error al consultar las métricas. Verifica el rango de fechas.",
        details: {
          from: cacheFrom.toISOString(),
          to: cacheTo.toISOString(),
          granularity
        }
      };
    }
  }

  const cacheKey = {
    reportKey: "metrics.overview",
    tenantId,
    from: cacheFrom,
    to: cacheTo,
    granularity,
    version: "v1"
  };

  const cached = await getReportCache(cacheKey);
  if (cached.hit && !cached.stale) {
    return { ok: true, data: cached.payload, cache: "HIT" };
  }
  if (cached.hit && cached.stale) {
    setImmediate(async () => {
      try {
        logger.info({ tenantId }, "[Metrics] Refreshing stale cache");
        const data = await getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity, tenantId });
        await refreshCache(cacheKey, data, cacheTtlSeconds, staleSeconds);
      } catch (err) {
        logger.error({ tenantId, err }, "[Metrics] Failed to refresh stale cache");
      }
    });
    return { ok: true, data: cached.payload, cache: "STALE" };
  }

  try {
    const data = await getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity, tenantId });
    await refreshCache(cacheKey, data, cacheTtlSeconds, staleSeconds);
    return { ok: true, data, cache: "MISS" };
  } catch (err: any) {
    return {
      ok: false,
      status: 400,
      error: "error_consultando_metricas",
      message: err?.message ? String(err.message) : "Error al consultar las métricas. Verifica el rango de fechas y el tenant.",
      details: {
        from: cacheFrom.toISOString(),
        to: cacheTo.toISOString(),
        granularity
      }
    };
  }
}
