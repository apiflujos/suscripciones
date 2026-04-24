import "server-only";

import { prisma } from "@suscripciones/database";

export function readCatalogProductIdFromPlanMetadata(metadata: unknown) {
  const meta = metadata && typeof metadata === "object" ? (metadata as any) : {};
  return String(meta?.catalog?.itemId || "").trim();
}

export function readCatalogProductIdFromPlan(plan: { catalogProductId?: string | null; metadata?: unknown } | null | undefined) {
  return String(plan?.catalogProductId || "").trim() || readCatalogProductIdFromPlanMetadata(plan?.metadata);
}

export async function listPlanIdsForCatalogProducts(args: {
  productIds: string[];
  tenantId?: string | null;
  includeCatalogItems?: boolean;
}) {
  const productIds = Array.from(new Set((args.productIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!productIds.length) return new Map<string, string[]>();

  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      OR: [
        ...(args.includeCatalogItems === false ? [] : [{ id: { in: productIds } }]),
        ...productIds.map((productId) => ({
          AND: [
            {
              OR: [
                { catalogProductId: productId },
                { metadata: { path: ["catalog", "itemId"], equals: productId } as any }
              ]
            },
            args.tenantId
              ? {
                  OR: [
                    { tenantId: args.tenantId },
                    { tenantLinks: { some: { tenantId: args.tenantId } } }
                  ]
                }
              : {}
          ]
        }))
      ]
    },
    select: { id: true, catalogProductId: true, metadata: true }
  });

  const byProductId = new Map<string, string[]>();
  for (const productId of productIds) byProductId.set(productId, args.includeCatalogItems === false ? [] : [productId]);

  for (const plan of plans) {
    const planId = String(plan.id || "").trim();
    if (!planId) continue;
    const linkedProductId = readCatalogProductIdFromPlan(plan);
    if (!linkedProductId || !byProductId.has(linkedProductId)) continue;
    const current = byProductId.get(linkedProductId) || [];
    if (!current.includes(planId)) current.push(planId);
    byProductId.set(linkedProductId, current);
  }

  return byProductId;
}

export async function resolveOperationalPlanForProduct(args: {
  productId?: string | null;
  tenantId?: string | null;
  activeOnly?: boolean;
}) {
  const productId = String(args.productId || "").trim();
  if (!productId) return null;

  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      ...(args.activeOnly === false ? {} : { active: true }),
      metadata: { path: ["kind"], not: "CATALOG_ITEM" } as any,
      AND: [
        {
          OR: [
            { catalogProductId: productId },
            { metadata: { path: ["catalog", "itemId"], equals: productId } as any }
          ]
        },
        args.tenantId
          ? {
              OR: [
                { tenantId: args.tenantId },
                { tenantLinks: { some: { tenantId: args.tenantId } } }
              ]
            }
          : {}
      ]
    },
    include: { tenantLinks: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });

  return plans[0] || null;
}
