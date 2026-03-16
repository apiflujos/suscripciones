import crypto from "crypto";
import { prisma } from "../db/prisma";

export type ReportCacheKey = {
  reportKey: string;
  tenantId: string;
  from: Date;
  to: Date;
  granularity?: string | null;
  filters?: Record<string, any> | null;
  version?: string | null;
};

export type ReportCacheHit = {
  hit: boolean;
  stale: boolean;
  payload?: any;
};

function stableStringify(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `"${k}":${stableStringify(value[k])}`);
  return `{${entries.join(",")}}`;
}

function hashFilters(filters: any): string | null {
  if (!filters || (typeof filters === "object" && Object.keys(filters).length === 0)) return null;
  const raw = stableStringify(filters);
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function getReportCache(key: ReportCacheKey): Promise<ReportCacheHit> {
  const filtersHash = hashFilters(key.filters);
  const row = await prisma.reportCache.findFirst({
    where: {
      reportKey: key.reportKey,
      tenantId: key.tenantId,
      from: key.from,
      to: key.to,
      granularity: key.granularity ?? null,
      filtersHash: filtersHash ?? null,
      version: key.version ?? null
    },
    select: { payload: true, expiresAt: true, staleAt: true }
  });

  if (!row) return { hit: false, stale: false };
  const now = Date.now();
  const expiresAt = row.expiresAt?.getTime() ?? 0;
  const staleAt = row.staleAt?.getTime() ?? 0;
  if (expiresAt > now) return { hit: true, stale: false, payload: row.payload };
  if (staleAt && staleAt > now) return { hit: true, stale: true, payload: row.payload };
  return { hit: false, stale: false };
}

export async function setReportCache(
  key: ReportCacheKey,
  payload: any,
  ttlSeconds: number,
  staleSeconds?: number
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(0, ttlSeconds) * 1000);
  const staleAt = staleSeconds ? new Date(now.getTime() + Math.max(0, staleSeconds) * 1000) : null;
  const filtersHash = hashFilters(key.filters);
  const existing = await prisma.reportCache.findFirst({
    where: {
      reportKey: key.reportKey,
      tenantId: key.tenantId,
      from: key.from,
      to: key.to,
      granularity: key.granularity ?? null,
      filtersHash: filtersHash ?? null,
      version: key.version ?? null
    },
    select: { id: true }
  });

  if (existing) {
    await prisma.reportCache.update({
      where: { id: existing.id },
      data: {
        payload,
        computedAt: now,
        expiresAt,
        staleAt
      }
    });
    return;
  }

  await prisma.reportCache.create({
    data: {
      reportKey: key.reportKey,
      tenantId: key.tenantId,
      from: key.from,
      to: key.to,
      granularity: key.granularity ?? null,
      filtersHash: filtersHash ?? null,
      version: key.version ?? null,
      payload,
      computedAt: now,
      expiresAt,
      staleAt
    }
  });
}
