import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { LogLevel, PlanIntervalUnit, PlanType } from "@prisma/client";
import { requireAdminToken } from "../_lib/requireAdminToken";
import { reqToCompat } from "../_lib/reqCompat";
import { consumeApp } from "@suscripciones/core/services/superAdminApp";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { getEffectiveTenantId, getEffectiveTenantIds } from "@suscripciones/core/services/tenantContext";
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from "@suscripciones/core/lib/currencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const currencyCodeSchema = z
  .preprocess((v) => normalizeCurrencyCode(v), z.string().min(3).max(3))
  .refine((v) => isSupportedCurrency(v), { message: "unsupported_currency" });

const createPlanSchema = z.object({
  name: z.string().min(1),
  priceInCents: z.number().int().positive(),
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
  intervalUnit: z.nativeEnum(PlanIntervalUnit),
  intervalCount: z.number().int().positive().default(1),
  collectionMode: z.enum(["MANUAL_LINK", "AUTO_LINK", "AUTO_DEBIT"]).optional().default("MANUAL_LINK"),
  planType: z.nativeEnum(PlanType).optional(),
  active: z.boolean().optional(),
  metadata: z.any().optional()
});

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 200;
  const q = String(url.searchParams.get("q") ?? "").trim();
  const mode = String(url.searchParams.get("collectionMode") ?? "").trim();

  const where: any = { NOT: { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } } as any;
  const and: any[] = [];
  if (tenantId) {
    const tenantFilter = { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] };
    and.push(tenantFilter);
  }
  if (mode) and.push({ metadata: { path: ["collectionMode"], equals: mode } } as any);
  if (and.length) where.AND = and;

  const rawItems = await prisma.subscriptionPlan.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q ? Math.max(take, 2000) : take,
    include: { tenantLinks: true }
  });
  const qNorm = q.toLowerCase();
  const items = q
    ? rawItems
        .filter((p: any) => {
          const md = p?.metadata && typeof p.metadata === "object" ? (p.metadata as any) : {};
          const catalog = md?.catalog && typeof md.catalog === "object" ? md.catalog : {};
          const searchable = [p?.name, p?.id, md?.displayName, md?.sku, catalog?.name, catalog?.title]
            .map((v) => String(v || "").toLowerCase())
            .join(" ");
          return searchable.includes(qNorm);
        })
        .slice(0, take)
    : rawItems;
  return Response.json({
    items: items.map((p: any) => ({
      ...p,
      tenantIds: Array.from(new Set([p.tenantId, ...(p.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[]
    }))
  });
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const compatReq = reqToCompat(req, body);
  const tenantIds = await getEffectiveTenantIds(compatReq);
  if (!tenantIds.length) return Response.json({ error: "tenant_required" }, { status: 400 });
  const primaryTenantId = tenantIds[0];
  const { collectionMode, planType, metadata, ...rest } = parsed.data;
  const mergedMetadata = {
    ...(metadata && typeof metadata === "object" ? (metadata as any) : {}),
    collectionMode
  };

  const computedPlanType: PlanType = collectionMode === "MANUAL_LINK" ? PlanType.manual_link : PlanType.auto_subscription;
  const effectivePlanType: PlanType = planType ?? computedPlanType;
  const finalPlanType: PlanType = collectionMode === "MANUAL_LINK" ? effectivePlanType : PlanType.auto_subscription;
  const plan = await prisma.subscriptionPlan.create({
    data: { ...(rest as any), tenantId: primaryTenantId, planType: finalPlanType as any, metadata: mergedMetadata as any }
  });
  await prisma.subscriptionPlanTenant.createMany({
    data: tenantIds.map((t) => ({ planId: plan.id, tenantId: t })),
    skipDuplicates: true
  });
  await consumeApp("plans_created", { amount: 1, source: "api:plans.create", meta: { planId: plan.id, planType: plan.planType } });
  return Response.json({ plan }, { status: 201 });
}
