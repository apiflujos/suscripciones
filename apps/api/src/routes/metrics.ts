import express from "express";
import { z } from "zod";
import { getMetricsOverview } from "../services/metrics";
import { getReportCache, setReportCache } from "../services/reportCache";
import { coerceTenantId, getEffectiveTenantId } from "../services/tenantContext";

function parseQueryDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Schema de validación tolerante con fecha ISO y YYYY-MM-DD
const querySchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  granularity: z.enum(["day", "week", "month"]).optional().default("day"),
  tenantId: z.string().uuid().optional().nullable()
}).refine(data => {
  const from = data.from ? parseQueryDate(data.from) : null;
  const to = data.to ? parseQueryDate(data.to) : null;
  if (data.from && !from) return false;
  if (data.to && !to) return false;
  if (from && to) {
    const days = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    return days <= 365 && days >= 0;
  }
  return true;
}, { message: "El rango de fechas no puede exceder 365 días y debe ser válido" });

function defaultRange() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Maneja el refresh de cache con proper error handling y logging
 */
async function refreshCache(
  cacheKey: any,
  data: any,
  cacheTtlSeconds: number,
  staleSeconds: number
) {
  try {
    await setReportCache(cacheKey, data, cacheTtlSeconds, staleSeconds);
    console.log('[MetricsCache] Updated cache', { key: cacheKey.reportKey, tenantId: cacheKey.tenantId });
  } catch (err: any) {
    console.error('[MetricsCache] Failed to update cache', { 
      key: cacheKey.reportKey, 
      tenantId: cacheKey.tenantId,
      error: err?.message || String(err) 
    });
  }
}

export const metricsRouter = express.Router();

metricsRouter.get("/overview", async (req, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    console.log('[Metrics] Invalid query params', { errors: parsed.error.flatten() });
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  const d = defaultRange();
  const from = parsed.data.from ? (parseQueryDate(parsed.data.from) || d.from) : d.from;
  const to = parsed.data.to ? (parseQueryDate(parsed.data.to) || d.to) : d.to;
  const hasExplicitRange = Boolean(parsed.data.from || parsed.data.to);
  const cacheTtlSeconds = 300;
  const staleSeconds = 900;
  const resolvedTenantId = coerceTenantId(parsed.data.tenantId) ?? (await getEffectiveTenantId(req)) ?? null;

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
      console.error('[Metrics] Error fetching metrics (no tenant)', { 
        error: err?.message,
        stack: err?.stack,
        from: cacheFrom,
        to: cacheTo
      });
      return res.status(400).json({ 
        error: "error_consultando_metricas", 
        message: err?.message ? String(err.message) : "Error al consultar las métricas. Verifica el rango de fechas.",
        details: {
          from: cacheFrom.toISOString(),
          to: cacheTo.toISOString(),
          granularity: parsed.data.granularity
        }
      });
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
    // Refresh en background con proper error handling
    setImmediate(async () => {
      try {
        console.log('[Metrics] Refreshing stale cache', { tenantId: resolvedTenantId });
        const data = await getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity: parsed.data.granularity, tenantId: resolvedTenantId });
        await refreshCache(cacheKey, data, cacheTtlSeconds, staleSeconds);
      } catch (err: any) {
        console.error('[Metrics] Failed to refresh stale cache', { 
          tenantId: resolvedTenantId, 
          error: err?.message || String(err) 
        });
      }
    });
    return;
  }

  try {
    const data = await getMetricsOverview({ from: cacheFrom, to: cacheTo, granularity: parsed.data.granularity, tenantId: resolvedTenantId });
    await refreshCache(cacheKey, data, cacheTtlSeconds, staleSeconds);
    res.setHeader("x-report-cache", "MISS");
    res.json(data);
  } catch (err: any) {
    console.error('[Metrics] Error fetching metrics', { 
      tenantId: resolvedTenantId, 
      error: err?.message,
      stack: err?.stack,
      from: cacheFrom,
      to: cacheTo
    });
    res.status(400).json({ 
      error: "error_consultando_metricas", 
      message: err?.message ? String(err.message) : "Error al consultar las métricas. Verifica el rango de fechas y el tenant.",
      details: {
        from: cacheFrom.toISOString(),
        to: cacheTo.toISOString(),
        granularity: parsed.data.granularity
      }
    });
  }
});
