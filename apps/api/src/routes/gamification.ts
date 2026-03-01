import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { getGamificationConfig, setGamificationConfig } from "../services/gamificationSettings";
import { GamificationEntityType } from "@prisma/client";

export const gamificationRouter = express.Router();

const updateConfigSchema = z.object({
  config: z.any()
});

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

  const rows = await prisma.$queryRawUnsafe<
    Array<{ entityId: string; score: bigint }>
  >(
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
    const customers = await prisma.customer.findMany({ where: { id: { in: ids } } });
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

  const plans = await prisma.subscriptionPlan.findMany({ where: { id: { in: ids } } });
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

gamificationRouter.get("/config", async (_req, res) => {
  const cfg = await getGamificationConfig();
  res.json({ config: cfg });
});

gamificationRouter.put("/config", async (req, res) => {
  const parsed = updateConfigSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const saved = await setGamificationConfig(parsed.data.config);
  res.json({ config: saved });
});

gamificationRouter.get("/trending", async (req, res) => {
  const tenantId = String(req.query.tenantId || "").trim() || null;
  const scope = String(req.query.scope || "customers");
  const hours = toHours(req.query.windowHours ?? req.query.hours ?? 24);
  const entityType = toEntity(scope);
  const items = await loadTrending(entityType, tenantId, hours);
  res.json({ items, hours, scope: entityType === GamificationEntityType.PRODUCT ? "products" : "customers" });
});
