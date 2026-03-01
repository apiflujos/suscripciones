import express from "express";
import { z } from "zod";
import { getMetricsOverview } from "../services/metrics";
import { getReportCache, setReportCache } from "../services/reportCache";
import { getEffectiveTenantId } from "../services/tenantContext";

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(["day", "week", "month"]).optional().default("day"),
  tenantId: z.string().optional()
});

function defaultRange() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export const metricsRouter = express.Router();

metricsRouter.get("/overview", async (req, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

  const d = defaultRange();
  const from = parsed.data.from ? new Date(parsed.data.from) : d.from;
  const to = parsed.data.to ? new Date(parsed.data.to) : d.to;
  const hasExplicitRange = Boolean(parsed.data.from || parsed.data.to);
  const cacheTtlSeconds = 300;
  const staleSeconds = 900;
  const resolvedTenantId = parsed.data.tenantId ?? (await getEffectiveTenantId(req)) ?? null;

  let cacheFrom = from;
  let cacheTo = to;
  if (!hasExplicitRange) {
    const bucketMs = cacheTtlSeconds * 1000;
    const alignedTo = new Date(Math.floor(to.getTime() / bucketMs) * bucketMs);
    const rangeMs = Math.max(24 * 60 * 60 * 1000, to.getTime() - from.getTime());
    cacheTo = alignedTo;
    cacheFrom = new Date(cacheTo.getTime() - rangeMs);
  }

  if (!resolvedTenantId) {
    try {
      const data = await getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity: parsed.data.granularity, tenantId: null });
      return res.json(data);
    } catch (err: any) {
      return res.status(400).json({ error: "invalid_range", message: err?.message ? String(err.message) : "invalid_range" });
    }
  }

  const cacheKey = {
    reportKey: "metrics.overview",
    tenantId: resolvedTenantId,
    from: cacheFrom,
    to: cacheTo,
    granularity: parsed.data.granularity,
    version: "v1"
  };

  const cached = await getReportCache(cacheKey);
  if (cached.hit && !cached.stale) {
    res.setHeader("x-report-cache", "HIT");
    return res.json(cached.payload);
  }
  if (cached.hit && cached.stale) {
    res.setHeader("x-report-cache", "STALE");
    res.json(cached.payload);
    setTimeout(() => {
      getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity: parsed.data.granularity, tenantId: resolvedTenantId })
        .then((data) => setReportCache(cacheKey, data, cacheTtlSeconds, staleSeconds))
        .catch(() => {});
    }, 0);
    return;
  }

  try {
    const data = await getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity: parsed.data.granularity, tenantId: resolvedTenantId });
    await setReportCache(cacheKey, data, cacheTtlSeconds, staleSeconds);
    res.setHeader("x-report-cache", "MISS");
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: "invalid_range", message: err?.message ? String(err.message) : "invalid_range" });
  }
});
