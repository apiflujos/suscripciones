import "server-only";

import { prisma } from "@suscripciones/database";
import { GamificationEntityType } from "@prisma/client";
import { getGamificationConfig as readGamificationConfig, setGamificationConfig } from "@suscripciones/core/services/gamificationSettings";

export async function listCustomerGamificationEvents(args: {
  customerId: string;
  tenantId?: string | null;
  includeGlobal?: boolean;
  take?: number;
}) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "invalid_id" as const };

  const takeRaw = Number(args.take ?? 30);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 30;
  const tenantId = String(args.tenantId || "").trim() || null;
  const includeGlobal = args.includeGlobal !== false;

  const where: any = { entityType: GamificationEntityType.CUSTOMER, entityId: customerId };
  if (tenantId) {
    where.OR = includeGlobal ? [{ tenantId }, { tenantId: null }] : [{ tenantId }];
  }

  const items = await prisma.gamificationEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take
  });

  return { ok: true, items };
}

export async function getCustomerRewards(args: { customerId: string }) {
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return { ok: false, status: 400, error: "invalid_id" as const };

  const rows = await prisma.gamificationRewardLedger.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  const byTenant = new Map<string, any>();
  for (const row of rows) {
    const key = row.tenantId ? String(row.tenantId) : "global";
    if (!byTenant.has(key)) {
      byTenant.set(key, {
        tenantId: row.tenantId || null,
        balance: row.balance,
        lastAt: row.createdAt
      });
    }
  }

  const global = byTenant.get("global") || null;
  const tenants = Array.from(byTenant.values()).filter((r) => r.tenantId);
  return { ok: true, global, byTenant: tenants };
}

export async function getGamificationConfig() {
  const config = await readGamificationConfig();
  return { ok: true, config };
}

export async function updateGamificationConfig(config: any) {
  const saved = await setGamificationConfig(config);
  return { ok: true, config: saved };
}

function toHours(raw: any) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(Math.max(1, Math.trunc(n)), 24 * 365);
}

function toEntity(scope: string) {
  const v = String(scope || "").toLowerCase();
  if (v === "products" || v === "product") return GamificationEntityType.PRODUCT;
  return GamificationEntityType.CUSTOMER;
}

async function loadTrending(entityType: GamificationEntityType, tenantId: string | null, hours: number) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const tenantFilter = tenantId ? `AND "tenantId" = '${tenantId}'::uuid` : "";

  const rows = await prisma.$queryRawUnsafe<Array<{ entityId: string; score: bigint }>>(
    `SELECT "entityId", SUM("statusDelta")::bigint AS score
     FROM "GamificationEvent"
     WHERE "entityType" = '${entityType}'::"GamificationEntityType"
       AND "createdAt" >= '${cutoff.toISOString()}'::timestamptz
       ${tenantFilter}
     GROUP BY 1
     ORDER BY score DESC
     LIMIT 3`
  );

  const ids = rows.map((r) => String(r.entityId));
  if (!ids.length) return [] as any[];

  if (entityType === GamificationEntityType.CUSTOMER) {
    const customers = await prisma.customer.findMany({ where: { id: { in: ids } } }) as Array<{
      id: string;
      name?: string | null;
      email?: string | null;
      phone?: string | null;
    }>;
    const map = new Map(customers.map((c) => [String(c.id), c]));
    return rows.map((row) => {
      const customer = map.get(String(row.entityId));
      return {
        id: String(row.entityId),
        score: Number(row.score || 0),
        name: customer?.name || customer?.email || customer?.phone || "Contacto",
        email: customer?.email || null,
        phone: customer?.phone || null
      };
    });
  }

  const plans = await prisma.subscriptionPlan.findMany({ where: { id: { in: ids } } }) as Array<{
    id: string;
    name?: string | null;
    metadata?: any;
  }>;
  const map = new Map(plans.map((p) => [String(p.id), p]));
  return rows.map((row) => {
    const plan = map.get(String(row.entityId));
    const meta: any = plan?.metadata || {};
    return {
      id: String(row.entityId),
      score: Number(row.score || 0),
      name: meta?.displayName || plan?.name || "Producto",
      productType: meta?.productType || null,
      vendor: meta?.vendor || null
    };
  });
}

export async function listGamificationTrending(args: { scope?: string; tenantId?: string | null; hours?: number }) {
  const tenantId = String(args.tenantId || "").trim() || null;
  const scope = String(args.scope || "customers");
  const hours = toHours(args.hours ?? 24);
  const entityType = toEntity(scope);
  const items = await loadTrending(entityType, tenantId, hours);

  return {
    ok: true,
    items,
    hours,
    scope: entityType === GamificationEntityType.PRODUCT ? "products" : "customers"
  };
}
