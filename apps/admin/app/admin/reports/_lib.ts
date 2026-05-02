import { z } from "zod";
import { getReportCache, setReportCache } from "@suscripciones/core/services/reportCache";
import { logger } from "@suscripciones/core/lib/logger";

export function parseQueryDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const querySchema = z
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
        return days <= 365;
      }
      return true;
    },
    { message: "Range cannot exceed 365 days", path: ["to"] }
  );

export function defaultRange() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function normalizeCacheRange(from: Date, to: Date, ttlSeconds: number, hasExplicitRange: boolean) {
  if (hasExplicitRange) return { from, to };
  const bucketMs = ttlSeconds * 1000;
  const alignedTo = new Date(Math.floor(to.getTime() / bucketMs) * bucketMs);
  const rangeMs = Math.max(24 * 60 * 60 * 1000, to.getTime() - from.getTime());
  const alignedFrom = new Date(alignedTo.getTime() - rangeMs);
  return { from: alignedFrom, to: alignedTo };
}

export async function refreshCache(
  cacheKey: any,
  compute: () => Promise<any>,
  ttlSeconds: number,
  staleSeconds: number
) {
  try {
    const payload = await compute();
    await setReportCache(cacheKey, payload, ttlSeconds, staleSeconds);
    logger.info({ key: cacheKey.reportKey, tenantId: cacheKey.tenantId }, "[ReportsCache] Updated cache");
  } catch (err) {
    logger.error({
      key: cacheKey.reportKey,
      tenantId: cacheKey.tenantId,
      err
    }, "[ReportsCache] Failed to update cache");
  }
}

export async function respondWithCache(
  key: { reportKey: string; tenantId: string; from: Date; to: Date; granularity?: string; version?: string },
  ttlSeconds: number,
  staleSeconds: number,
  compute: () => Promise<any>
) {
  const cached = await getReportCache(key);
  if (cached.hit && !cached.stale) {
    return Response.json(cached.payload, { headers: { "x-report-cache": "HIT" } });
  }
  if (cached.hit && cached.stale) {
    setImmediate(() => refreshCache(key, compute, ttlSeconds, staleSeconds));
    return Response.json(cached.payload, { headers: { "x-report-cache": "STALE" } });
  }
  const payload = await compute();
  await setReportCache(key, payload, ttlSeconds, staleSeconds);
  return Response.json(payload, { headers: { "x-report-cache": "MISS" } });
}
