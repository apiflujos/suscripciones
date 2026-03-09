import express from "express";
import { z } from "zod";
import { getCommerceReport, getOperationsReport, getChatwootReport } from "../services/reports";
import { getReportCache, setReportCache } from "../services/reportCache";
import { coerceTenantId, getEffectiveTenantId } from "../services/tenantContext";

// Schema de validación mejorado con UUID y límites de rango
const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(["day", "week", "month"]).optional().default("day"),
  tenantId: z.string().uuid().optional().nullable()
}).refine(data => {
  if (data.from && data.to) {
    const days = (new Date(data.to).getTime() - new Date(data.from).getTime()) / (1000 * 60 * 60 * 24);
    return days <= 365;
  }
  return true;
}, { message: "Range cannot exceed 365 days", path: ["to"] });

function defaultRange() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function normalizeCacheRange(
  from: Date,
  to: Date,
  ttlSeconds: number,
  hasExplicitRange: boolean
) {
  if (hasExplicitRange) return { from, to };
  const bucketMs = ttlSeconds * 1000;
  const alignedTo = new Date(Math.floor(to.getTime() / bucketMs) * bucketMs);
  const rangeMs = Math.max(24 * 60 * 60 * 1000, to.getTime() - from.getTime());
  const alignedFrom = new Date(alignedTo.getTime() - rangeMs);
  return { from: alignedFrom, to: alignedTo };
}

async function refreshCache(
  cacheKey: any,
  compute: () => Promise<any>,
  ttlSeconds: number,
  staleSeconds: number
) {
  try {
    const payload = await compute();
    await setReportCache(cacheKey, payload, ttlSeconds, staleSeconds);
    console.log('[ReportsCache] Updated cache', { key: cacheKey.reportKey, tenantId: cacheKey.tenantId });
  } catch (err: any) {
    console.error('[ReportsCache] Failed to update cache', { 
      key: cacheKey.reportKey, 
      tenantId: cacheKey.tenantId,
      error: err?.message || String(err) 
    });
  }
}

async function respondWithCache(
  res: express.Response,
  key: { reportKey: string; tenantId: string; from: Date; to: Date; granularity?: string; version?: string },
  ttlSeconds: number,
  staleSeconds: number,
  compute: () => Promise<any>
) {
  const cached = await getReportCache(key);
  if (cached.hit && !cached.stale) {
    res.setHeader("x-report-cache", "HIT");
    return res.json(cached.payload);
  }
  if (cached.hit && cached.stale) {
    res.setHeader("x-report-cache", "STALE");
    res.json(cached.payload);
    // Refresh en background con proper error handling
    setImmediate(() => refreshCache(key, compute, ttlSeconds, staleSeconds));
    return;
  }
  const payload = await compute();
  await setReportCache(key, payload, ttlSeconds, staleSeconds);
  res.setHeader("x-report-cache", "MISS");
  return res.json(payload);
}

export const reportsRouter = express.Router();

reportsRouter.get("/commerce", async (req, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  const d = defaultRange();
  const from = parsed.data.from ? new Date(parsed.data.from) : d.from;
  const to = parsed.data.to ? new Date(parsed.data.to) : d.to;
  const hasExplicitRange = Boolean(parsed.data.from || parsed.data.to);
  const ttlSeconds = 300;
  const staleSeconds = 900;
  const cacheRange = normalizeCacheRange(from, to, ttlSeconds, hasExplicitRange);
  const tenantId = coerceTenantId(parsed.data.tenantId) ?? (await getEffectiveTenantId(req)) ?? null;
  if (!tenantId) {
    const payload = await getCommerceReport({ from: cacheRange.from, to: cacheRange.to, granularity: parsed.data.granularity, tenantId: null });
    return res.json(payload);
  }
  const key = {
    reportKey: "reports.commerce",
    tenantId,
    from: cacheRange.from,
    to: cacheRange.to,
    granularity: parsed.data.granularity,
    version: "v1"
  };
  return respondWithCache(res, key, ttlSeconds, staleSeconds, () =>
    getCommerceReport({ from: cacheRange.from, to: cacheRange.to, granularity: parsed.data.granularity, tenantId })
  );
});

reportsRouter.get("/operations", async (req, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  const d = defaultRange();
  const from = parsed.data.from ? new Date(parsed.data.from) : d.from;
  const to = parsed.data.to ? new Date(parsed.data.to) : d.to;
  const hasExplicitRange = Boolean(parsed.data.from || parsed.data.to);
  const ttlSeconds = 60;
  const staleSeconds = 300;
  const cacheRange = normalizeCacheRange(from, to, ttlSeconds, hasExplicitRange);
  const tenantId = coerceTenantId(parsed.data.tenantId) ?? (await getEffectiveTenantId(req)) ?? null;
  if (!tenantId) {
    const payload = await getOperationsReport({ from: cacheRange.from, to: cacheRange.to, granularity: parsed.data.granularity, tenantId: null });
    return res.json(payload);
  }
  const key = {
    reportKey: "reports.operations",
    tenantId,
    from: cacheRange.from,
    to: cacheRange.to,
    granularity: parsed.data.granularity,
    version: "v1"
  };
  return respondWithCache(res, key, ttlSeconds, staleSeconds, () =>
    getOperationsReport({ from: cacheRange.from, to: cacheRange.to, granularity: parsed.data.granularity, tenantId })
  );
});

reportsRouter.get("/chatwoot", async (req, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  const d = defaultRange();
  const from = parsed.data.from ? new Date(parsed.data.from) : d.from;
  const to = parsed.data.to ? new Date(parsed.data.to) : d.to;
  const hasExplicitRange = Boolean(parsed.data.from || parsed.data.to);
  const ttlSeconds = 60;
  const staleSeconds = 300;
  const cacheRange = normalizeCacheRange(from, to, ttlSeconds, hasExplicitRange);
  const tenantId = coerceTenantId(parsed.data.tenantId) ?? (await getEffectiveTenantId(req)) ?? null;
  if (!tenantId) {
    const payload = await getChatwootReport({ from: cacheRange.from, to: cacheRange.to, granularity: parsed.data.granularity, tenantId: null });
    return res.json(payload);
  }
  const key = {
    reportKey: "reports.chatwoot",
    tenantId,
    from: cacheRange.from,
    to: cacheRange.to,
    granularity: parsed.data.granularity,
    version: "v1"
  };
  return respondWithCache(res, key, ttlSeconds, staleSeconds, () =>
    getChatwootReport({ from: cacheRange.from, to: cacheRange.to, granularity: parsed.data.granularity, tenantId })
  );
});
