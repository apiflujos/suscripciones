import "server-only";

import fs from "fs/promises";
import path from "path";
import { prisma } from "@suscripciones/database";
import { PlanIntervalUnit, SubscriptionStatus } from "@prisma/client";
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "@suscripciones/core/lib/currencies";
import { getMediaDir } from "@suscripciones/core/services/mediaStorage";
import { getPublicBaseUrlFromEnv } from "@suscripciones/core/services/publicBase";
import { logger } from "@suscripciones/core/lib/logger";
import { listPlanIdsForCatalogProducts } from "./productPlanMapping";

function normalizeSku(input: string) {
  return String(input || "").trim().toUpperCase();
}

export async function createCatalogProduct(args: {
  tenantIds: string[];
  name: string;
  sku: string;
  kind?: "PRODUCT" | "SERVICE";
  currency?: string;
  basePriceInCents: number;
  intervalUnit?: PlanIntervalUnit;
  intervalCount?: number;
  taxPercent?: number;
  discountType?: string;
  discountValueInCents?: number;
  discountPercent?: number;
  requiresShipping?: boolean;
  description?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string | null;
  unit?: string | null;
  taxable?: boolean;
  metadata?: any;
}): Promise<{ ok: true; productId: string } | { ok: false; status: number; error: string; details?: any }> {
  const tenantIds = args.tenantIds.filter(Boolean);
  if (!tenantIds.length) return { ok: false, status: 400, error: "tenant_required" };

  const sku = normalizeSku(args.sku);
  if (!sku) return { ok: false, status: 400, error: "invalid_sku" };

  const existing = await prisma.subscriptionPlan.findFirst({
    where: {
      metadata: { path: ["sku"], equals: sku } as any,
      ...(tenantIds[0] ? { tenantId: tenantIds[0] } : {})
    } as any
  });
  if (existing) {
    return { ok: false, status: 409, error: "sku_ya_existe", details: { productId: existing.id } };
  }

  const intervalUnit = args.intervalUnit ?? PlanIntervalUnit.MONTH;
  const intervalCountRaw = Number(args.intervalCount ?? 1);
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;

  try {
    const product = await prisma.subscriptionPlan.create({
      data: {
        tenantId: tenantIds[0],
        name: `[${sku}] ${args.name}`,
        currency: normalizeCurrencyCode(args.currency || DEFAULT_CURRENCY) || DEFAULT_CURRENCY,
        priceInCents: args.basePriceInCents,
        intervalUnit,
        intervalCount,
        metadata: {
          ...(args.metadata && typeof args.metadata === "object" ? (args.metadata as any) : {}),
          kind: "CATALOG_ITEM",
          sku,
          displayName: args.name,
          itemKind: args.kind || "PRODUCT",
          description: args.description || null,
          vendor: args.vendor || null,
          productType: args.productType || null,
          tags: args.tags || null,
          unit: args.unit || null,
          taxable: args.taxable ?? true,
          requiresShipping: args.requiresShipping ?? false,
          taxPercent: args.taxPercent ?? 0,
          discountType: args.discountType || "NONE",
          discountValueInCents: args.discountValueInCents || 0,
          discountPercent: args.discountPercent || 0
        } as any
      }
    });
    await prisma.subscriptionPlanTenant.createMany({
      data: tenantIds.map((t) => ({ planId: product.id, tenantId: t })),
      skipDuplicates: true
    });
    return { ok: true, productId: product.id };
  } catch (err: any) {
    if (err?.code === "P2002") {
      return { ok: false, status: 409, error: "registro_duplicado", details: err?.meta?.target || "desconocida" };
    }
    return { ok: false, status: 500, error: "create_failed", details: String(err?.message || err) };
  }
}

function normalizeImageUrl(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/public/media/")) return `${parsed.origin}${parsed.pathname}`;
    } catch {
      // Keep original URL if parsing fails.
    }
    return value;
  }
  if (value.startsWith("/")) {
    if (value.startsWith("/public/media/")) return value.split("?")[0]?.split("#")[0] || value;
    return value;
  }
  if (!value.includes("/") && /\.(jpe?g|png|webp|gif)$/i.test(value)) {
    const base = getPublicBaseUrlFromEnv();
    return base ? `${base}/public/media/${value}` : `/public/media/${value}`;
  }
  return null;
}

function extractPublicMediaFilename(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return null;
  let pathname = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return null;
    }
  }
  if (!pathname.startsWith("/public/media/")) return null;
  const tail = pathname.slice("/public/media/".length);
  const decoded = decodeURIComponent(tail.split("?")[0]?.split("#")[0] || "");
  const safe = path.basename(decoded);
  if (!safe || safe !== decoded) return null;
  return safe;
}

async function mediaFileExists(filename: string) {
  try {
    await fs.access(path.join(getMediaDir(), filename));
    return true;
  } catch {
    return false;
  }
}

async function normalizeImageUrlForOutput(raw: unknown) {
  const normalized = normalizeImageUrl(raw);
  if (!normalized) return null;
  const filename = extractPublicMediaFilename(normalized);
  if (!filename) return normalized;
  const exists = await mediaFileExists(filename);
  return exists ? normalized : null;
}

function computeTotalsForCatalog(args: {
  basePriceInCents: number;
  variantDeltaInCents: number;
  discountType?: string | null;
  discountValueInCents?: number | null;
  discountPercent?: number | null;
  taxPercent?: number | null;
}) {
  const base = Number(args.basePriceInCents || 0);
  const delta = Number(args.variantDeltaInCents || 0);
  const taxPercent = Number(args.taxPercent || 0);
  const discountType = String(args.discountType || "NONE");
  const discountValue = Number(args.discountValueInCents || 0);
  const discountPercent = Number(args.discountPercent || 0);

  let subtotal = base + delta;
  if (discountType === "FIXED") subtotal -= discountValue;
  else if (discountType === "PERCENT") subtotal -= Math.round((subtotal * discountPercent) / 100);
  if (subtotal < 0) subtotal = 0;
  const tax = Math.round((subtotal * taxPercent) / 100);
  return { subtotalInCents: subtotal, taxInCents: tax, totalInCents: subtotal + tax };
}

export async function getCatalogProductById(args: { productId: string; tenantId?: string | null }) {
  const id = String(args.productId || "").trim();
  if (!id) return { ok: false, status: 400, error: "invalid_id" as const };

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return { ok: false, status: 404, error: "not_found" as const };
  if ((plan.metadata as any)?.kind !== "CATALOG_ITEM") return { ok: false, status: 404, error: "not_found" as const };
  if (plan.active === false) return { ok: false, status: 404, error: "not_found" as const };
  if (args.tenantId) {
    const allowed = plan.tenantId === args.tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "not_found" as const };
  }
  const imageUrl = await normalizeImageUrlForOutput((plan.metadata as any)?.imageUrl);

  return {
    ok: true,
    item: {
      id: plan.id,
      tenantId: plan.tenantId || null,
      tenantIds: Array.from(new Set([plan.tenantId, ...(plan.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[],
      name: (plan.metadata as any)?.displayName || plan.name,
      sku: (plan.metadata as any)?.sku || "",
      kind: (plan.metadata as any)?.itemKind || "PRODUCT",
      description: (plan.metadata as any)?.description || null,
      vendor: (plan.metadata as any)?.vendor || null,
      productType: (plan.metadata as any)?.productType || null,
      tags: (plan.metadata as any)?.tags || null,
      unit: (plan.metadata as any)?.unit || null,
      taxable: (plan.metadata as any)?.taxable ?? true,
      requiresShipping: (plan.metadata as any)?.requiresShipping ?? false,
      currency: plan.currency,
      basePriceInCents: plan.priceInCents,
      intervalUnit: plan.intervalUnit,
      intervalCount: plan.intervalCount,
      taxPercent: (plan.metadata as any)?.taxPercent || 0,
      discountType: (plan.metadata as any)?.discountType || "NONE",
      discountValueInCents: (plan.metadata as any)?.discountValueInCents || 0,
      discountPercent: (plan.metadata as any)?.discountPercent || 0,
      option1Name: (plan.metadata as any)?.option1Name || null,
      option2Name: (plan.metadata as any)?.option2Name || null,
      variants: (plan.metadata as any)?.variants || null,
      imageUrl,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }
  };
}

export async function updateCatalogProduct(args: {
  productId: string;
  tenantId?: string | null;
  tenantIds?: string[];
  primaryTenantId?: string | null;
  name: string;
  sku: string;
  kind: "PRODUCT" | "SERVICE";
  currency: string;
  basePriceInCents: number;
  intervalUnit?: PlanIntervalUnit;
  intervalCount?: number;
  taxPercent?: number;
  discountType?: string;
  discountValueInCents?: number;
  discountPercent?: number;
  description?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string | null;
  unit?: string | null;
  taxable?: boolean;
  requiresShipping?: boolean;
  option1Name?: string | null;
  option2Name?: string | null;
  variants?: any[] | null;
  imageUrl?: string | null;
  metadata?: any;
}): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const id = String(args.productId || "").trim();
  if (!id) return { ok: false, status: 400, error: "invalid_id" };

  const existing = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!existing) return { ok: false, status: 404, error: "not_found" };
  if ((existing.metadata as any)?.kind !== "CATALOG_ITEM") return { ok: false, status: 404, error: "not_found" };
  if (args.tenantId) {
    const allowed = existing.tenantId === args.tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "not_found" };
  }

  const skuRaw = String(args.sku || "").trim();
  const skuNormalized = skuRaw ? skuRaw.toUpperCase() : "";
  const existingSku = String((existing.metadata as any)?.sku || "").trim().toUpperCase();
  const requestedTenantIds = Array.from(new Set((args.tenantIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
  const requestedPrimaryTenantId = String(args.primaryTenantId || "").trim();
  if (requestedPrimaryTenantId && requestedTenantIds.length && !requestedTenantIds.includes(requestedPrimaryTenantId)) {
    return { ok: false, status: 400, error: "primary_tenant_not_in_list" };
  }
  const primaryTenantId = requestedPrimaryTenantId || requestedTenantIds[0] || existing.tenantId || null;

  if (skuNormalized && skuNormalized !== existingSku) {
    const clash = await prisma.subscriptionPlan.findFirst({
      where: {
        id: { not: id },
        metadata: { path: ["sku"], equals: skuNormalized } as any,
        ...(primaryTenantId ? { tenantId: primaryTenantId } : {})
      } as any
    });
    if (clash) return { ok: false, status: 409, error: "sku_exists" };
  }

  const mergedMetadata = {
    ...(existing.metadata && typeof existing.metadata === "object" ? (existing.metadata as any) : {}),
    kind: "CATALOG_ITEM",
    sku: skuNormalized || args.sku,
    displayName: args.name,
    itemKind: args.kind,
    collectionMode: null,
    description: args.description || null,
    vendor: args.vendor || null,
    productType: args.productType || null,
    tags: args.tags || null,
    unit: args.unit || null,
    taxable: args.taxable ?? true,
    requiresShipping: args.requiresShipping ?? false,
    taxPercent: args.taxPercent ?? 0,
    discountType: args.discountType || "NONE",
    discountValueInCents: args.discountValueInCents || 0,
    discountPercent: args.discountPercent || 0,
    option1Name: args.option1Name || null,
    option2Name: args.option2Name || null,
    variants: args.variants ? (args.variants as any) : null,
    imageUrl: normalizeImageUrl(args.imageUrl)
  };

  const updated = await prisma.subscriptionPlan.update({
    where: { id },
    data: {
      ...(primaryTenantId ? { tenantId: primaryTenantId } : {}),
      name: `[${skuNormalized || args.sku}] ${args.name}`,
      currency: args.currency,
      priceInCents: args.basePriceInCents,
      metadata: mergedMetadata as any
    }
  });

  const relatedPlanIds = (await listPlanIdsForCatalogProducts({ productIds: [id], includeCatalogItems: false })).get(id) || [];
  const plansToUpdate = relatedPlanIds.length
    ? await prisma.subscriptionPlan.findMany({
        where: { id: { in: relatedPlanIds } }
      })
    : [];
  if (plansToUpdate.length) {
    await Promise.all(
      plansToUpdate.map((plan: any) => {
        const meta: any = plan.metadata && typeof plan.metadata === "object" ? plan.metadata : {};
        const variantDelta = Number(meta?.catalog?.variantDeltaInCents || 0);
        const totals = computeTotalsForCatalog({
          basePriceInCents: args.basePriceInCents,
          variantDeltaInCents: variantDelta,
          discountType: args.discountType,
          discountValueInCents: args.discountValueInCents,
          discountPercent: args.discountPercent,
          taxPercent: args.taxPercent
        });
        const nextMeta = {
          ...meta,
          catalog: {
            ...(meta.catalog || {}),
            itemId: id,
            sku: args.sku,
            name: args.name,
            kind: args.kind,
            option1Name: args.option1Name || null,
            option2Name: args.option2Name || null
          },
          pricing: {
            ...(meta.pricing || {}),
            basePriceInCents: args.basePriceInCents,
            discountType: args.discountType || "NONE",
            discountValueInCents: args.discountValueInCents || 0,
            discountPercent: args.discountPercent || 0,
            taxPercent: args.taxPercent || 0,
            totalInCents: totals.totalInCents
          }
        };
        return prisma.subscriptionPlan.update({
          where: { id: plan.id },
          data: {
            priceInCents: totals.totalInCents,
            metadata: nextMeta as any
          }
        });
      })
    );
  }

  if (requestedTenantIds.length) {
    await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: id } });
    await prisma.subscriptionPlanTenant.createMany({
      data: requestedTenantIds.map((t) => ({ planId: id, tenantId: t })),
      skipDuplicates: true
    });
  }

  return { ok: true, id: updated.id };
}

export async function deleteCatalogProduct(args: { productId: string; tenantId?: string | null; force?: boolean }) {
  const id = String(args.productId || "").trim();
  if (!id) return { ok: false, status: 400, error: "id_invalido" as const };

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return { ok: false, status: 404, error: "producto_no_encontrado" as const };

  if (args.tenantId) {
    const allowed = plan.tenantId === args.tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === args.tenantId);
    if (!allowed) return { ok: false, status: 404, error: "producto_no_encontrado" as const };
  }

  if ((plan.metadata as any)?.kind !== "CATALOG_ITEM") return { ok: false, status: 404, error: "producto_no_encontrado" as const };

  const planIdsByProduct = await listPlanIdsForCatalogProducts({ productIds: [id] });
  const relatedPlanIds = Array.from(new Set(planIdsByProduct.get(id) || [id]));
  const dependentPlans = relatedPlanIds.filter((planId) => planId !== id).map((planId) => ({ id: planId }));
  const blockingStatuses: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED];
  const activeBlocking = await prisma.subscription.findMany({
    where: { planId: { in: relatedPlanIds }, status: { in: blockingStatuses } },
    select: { id: true, status: true, customerId: true, planId: true },
    take: 20
  });
  if (activeBlocking.length) {
    return {
      ok: false,
      status: 409,
      error: "producto_tiene_suscripciones_activas",
      details: {
        count: activeBlocking.length,
        statuses: blockingStatuses,
        samples: activeBlocking
      }
    };
  }

  const [subscriptionsCount, paymentLinksCount] = await Promise.all([
    prisma.subscription.count({ where: { planId: { in: relatedPlanIds } } }),
    prisma.paymentLink.count({ where: { planId: { in: relatedPlanIds } } })
  ]);

  const force = Boolean(args.force);
  if (!force && (subscriptionsCount || paymentLinksCount || dependentPlans.length)) {
    return {
      ok: false,
      status: 409,
      error: "producto_tiene_dependencias",
      details: { subscriptionsCount, paymentLinksCount, dependentPlansCount: dependentPlans.length }
    };
  }

  if (force) {
    const subs = await prisma.subscription.findMany({ where: { planId: { in: relatedPlanIds } }, select: { id: true } });
    const subIds = subs.map((s: any) => s.id);
    const payments = await prisma.payment.findMany({ where: { subscriptionId: { in: subIds } }, select: { id: true } });
    const paymentIds = payments.map((p: any) => p.id);

    if (paymentIds.length) {
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch((err: any) => {
        logger.warn({ err, productId: id, paymentIds }, "Fallo limpiando payment attempts al borrar producto");
      });
    }
    await prisma.chatwootMessage.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch((err: any) => {
      logger.warn({ err, productId: id, subIds }, "Fallo limpiando mensajes Chatwoot al borrar producto");
    });
    await prisma.paymentLink
      .deleteMany({ where: { OR: [{ subscriptionId: { in: subIds } }, { planId: { in: relatedPlanIds } }] } })
      .catch((err: any) => {
        logger.warn({ err, productId: id, subIds, relatedPlanIds }, "Fallo limpiando payment links al borrar producto");
      });
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch((err: any) => {
      logger.warn({ err, productId: id, subIds }, "Fallo limpiando pagos al borrar producto");
    });
    await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch((err: any) => {
      logger.warn({ err, productId: id, subIds }, "Fallo limpiando tenants de suscripcion al borrar producto");
    });
    await prisma.subscription.deleteMany({ where: { id: { in: subIds } } }).catch((err: any) => {
      logger.warn({ err, productId: id, subIds }, "Fallo limpiando suscripciones al borrar producto");
    });
    await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: { in: relatedPlanIds } } }).catch((err: any) => {
      logger.warn({ err, productId: id, relatedPlanIds }, "Fallo limpiando tenants de planes al borrar producto");
    });
    await prisma.subscriptionPlan.deleteMany({ where: { id: { in: relatedPlanIds } } }).catch((err: any) => {
      logger.warn({ err, productId: id, relatedPlanIds }, "Fallo limpiando planes relacionados al borrar producto");
    });
  } else {
    await prisma.subscriptionPlan.delete({ where: { id } });
  }

  return { ok: true };
}
function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

export async function listCatalogProducts(args: {
  tenantId?: string | null;
  includeInactive?: boolean;
  take?: number;
  skip?: number;
  q?: string;
  ids?: string[];
}) {
  const tenantId = args.tenantId || null;
  const includeInactive = Boolean(args.includeInactive);
  const takeRaw = Number(args.take ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 1000) : 200;
  const skipRaw = Number(args.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(args.q ?? "").trim();
  const ids = Array.isArray(args.ids) ? args.ids.map((v) => v.trim()).filter(Boolean) : [];

  const where: any = { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } as any;
  if (!includeInactive) where.active = true;
  if (tenantId) {
    const tenantFilter = { OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }] };
    where.AND = Array.isArray(where.AND) ? [...where.AND, tenantFilter] : [tenantFilter];
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { metadata: { path: ["displayName"], string_contains: q } } as any,
      { metadata: { path: ["sku"], string_contains: q } } as any
    ];
  }

  if (ids.length) {
    where.AND = Array.isArray(where.AND) ? [...where.AND, { id: { in: ids } }] : [{ id: { in: ids } }];
  }

  const items = await prisma.subscriptionPlan.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { tenantLinks: true }
  });
  const total = await prisma.subscriptionPlan.count({ where });
  const productIds = items.map((p: any) => String(p.id)).filter(Boolean);

  const activeSubsByProduct = new Map<string, number>();
  const pastDueSubsByProduct = new Map<string, number>();
  const totalSubsByProduct = new Map<string, number>();

  if (productIds.length) {
    const planIdsByProduct = await listPlanIdsForCatalogProducts({ productIds });
    const productIdsByPlanId = new Map<string, string[]>();
    for (const [productId, planIds] of planIdsByProduct.entries()) {
      for (const planId of planIds) {
        const current = productIdsByPlanId.get(planId) || [];
        if (!current.includes(productId)) current.push(productId);
        productIdsByPlanId.set(planId, current);
      }
    }

    const relatedPlanIds = Array.from(new Set(Array.from(planIdsByProduct.values()).flat())).filter(Boolean);
    const accumulate = (target: Map<string, number>, rows: any[]) => {
      for (const row of rows as any[]) {
        const planId = String(row?.planId || "");
        if (!planId) continue;
        const resolvedProductIds = productIdsByPlanId.get(planId) || [];
        for (const productId of resolvedProductIds) {
          target.set(productId, Number(target.get(productId) || 0) + Number(row?._count?._all || 0));
        }
      }
    };

    if (relatedPlanIds.length) {
      const activeGrouped = await prisma.subscription.groupBy({
        by: ["planId"],
        where: { planId: { in: relatedPlanIds }, status: SubscriptionStatus.ACTIVE },
        _count: { _all: true }
      });
      accumulate(activeSubsByProduct, activeGrouped as any[]);

      const pastDueGrouped = await prisma.subscription.groupBy({
        by: ["planId"],
        where: { planId: { in: relatedPlanIds }, status: SubscriptionStatus.PAST_DUE },
        _count: { _all: true }
      });
      accumulate(pastDueSubsByProduct, pastDueGrouped as any[]);

      const totalGrouped = await prisma.subscription.groupBy({
        by: ["planId"],
        where: {
          planId: { in: relatedPlanIds },
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED] }
        },
        _count: { _all: true }
      });
      accumulate(totalSubsByProduct, totalGrouped as any[]);
    }
  }

  const mappedItems = await Promise.all(items.map(async (p: any) => ({
      ...(() => {
        const pricing = readPlanPricing(p.metadata);
        return { shippingInCents: Number(pricing?.shippingInCents || 0) };
      })(),
      id: p.id,
      tenantId: p.tenantId || null,
      tenantIds: Array.from(new Set([p.tenantId, ...(p.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))) as string[],
      name: (p.metadata as any)?.displayName || p.name,
      sku: (p.metadata as any)?.sku || "",
      kind: (p.metadata as any)?.itemKind || "PRODUCT",
      description: (p.metadata as any)?.description || null,
      vendor: (p.metadata as any)?.vendor || null,
      productType: (p.metadata as any)?.productType || null,
      tags: (p.metadata as any)?.tags || null,
      unit: (p.metadata as any)?.unit || null,
      taxable: (p.metadata as any)?.taxable ?? true,
      requiresShipping: (p.metadata as any)?.requiresShipping ?? false,
      currency: p.currency,
      basePriceInCents: p.priceInCents,
      intervalUnit: p.intervalUnit,
      intervalCount: p.intervalCount,
      collectionMode: (p.metadata as any)?.collectionMode || null,
      taxPercent: (p.metadata as any)?.taxPercent || 0,
      discountType: (p.metadata as any)?.discountType || "NONE",
      discountValueInCents: (p.metadata as any)?.discountValueInCents || 0,
      discountPercent: (p.metadata as any)?.discountPercent || 0,
      option1Name: (p.metadata as any)?.option1Name || null,
      option2Name: (p.metadata as any)?.option2Name || null,
      variants: (p.metadata as any)?.variants || null,
      imageUrl: await normalizeImageUrlForOutput((p.metadata as any)?.imageUrl),
      activeSubscriptions: Number(activeSubsByProduct.get(String(p.id)) || 0),
      pastDueSubscriptions: Number(pastDueSubsByProduct.get(String(p.id)) || 0),
      totalSubscriptions: Number(totalSubsByProduct.get(String(p.id)) || 0),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    })));

  return {
    items: mappedItems,
    total
  };
}

export async function getActiveProducts(args: {
  tenantId?: string | null;
  take?: number;
  skip?: number;
  q?: string;
  ids?: string[];
}) {
  return listCatalogProducts({
    tenantId: args.tenantId || null,
    take: args.take,
    skip: args.skip,
    q: args.q,
    ids: args.ids,
    includeInactive: false
  });
}

export async function searchActiveProducts(args: { q: string; take: number; tenantId?: string | null }) {
  const result = await getActiveProducts({
    tenantId: args.tenantId || null,
    q: args.q,
    take: args.take
  });
  return result.items;
}
