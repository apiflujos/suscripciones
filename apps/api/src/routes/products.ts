import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { LogLevel, PlanIntervalUnit, SubscriptionStatus } from "@prisma/client";
import { systemLog } from "../services/systemLog";
import { getEffectiveTenantId, getEffectiveTenantIds, readTenantIdsFromReq } from "../services/tenantContext";
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from "../lib/currencies";

const variantRowSchema = z.object({
  option1: z.string().optional().nullable(),
  option2: z.string().optional().nullable(),
  priceDeltaInCents: z.number().int()
});

const currencyCodeSchema = z
  .preprocess((v) => normalizeCurrencyCode(v), z.string().min(3).max(3))
  .refine((v) => isSupportedCurrency(v), { message: "unsupported_currency" });

const createProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  kind: z.enum(["PRODUCT", "SERVICE"]).optional().default("PRODUCT"),
  currency: currencyCodeSchema.optional().default(DEFAULT_CURRENCY),
  basePriceInCents: z.number().int().nonnegative(),
  intervalUnit: z.nativeEnum(PlanIntervalUnit).optional().default(PlanIntervalUnit.MONTH),
  intervalCount: z.number().int().positive().optional().default(1),
  taxPercent: z.number().int().min(0).max(100).optional().default(0),
  discountType: z.enum(["NONE", "FIXED", "PERCENT"]).optional().default("NONE"),
  discountValueInCents: z.number().int().nonnegative().optional().default(0),
  discountPercent: z.number().int().min(0).max(100).optional().default(0),
  description: z.string().optional().nullable(),
  vendor: z.string().optional().nullable(),
  productType: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  taxable: z.boolean().optional().default(true),
  requiresShipping: z.boolean().optional().default(false),
  option1Name: z.string().min(1).optional().nullable(),
  option2Name: z.string().min(1).optional().nullable(),
  variants: z.array(variantRowSchema).optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  metadata: z.any().optional()
});

export const productsRouter = express.Router();

function readPlanPricing(meta: any) {
  if (!meta || typeof meta !== "object") return {};
  const root = meta?.pricing;
  const legacy = meta?.catalog?.pricing;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
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

productsRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const tenantId = await getEffectiveTenantId(req);
  const includeInactiveRaw = String(req?.query?.includeInactive ?? "").trim().toLowerCase();
  const includeInactive = includeInactiveRaw === "1" || includeInactiveRaw === "true" || includeInactiveRaw === "yes";
  const takeRaw = Number(req?.query?.take ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 1000) : 200;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(req?.query?.q ?? "").trim();
  const idsParam = req?.query?.ids;
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (typeof idsParam !== "undefined" && (idsEmpty || ids.length === 0)) {
    return res.json({ items: [], total: 0 });
  }

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
  const planIds = items.map((p: any) => String(p.id)).filter(Boolean);
  const activeSubsByPlan = new Map<string, number>();
  if (planIds.length) {
    const grouped = await prisma.subscription.groupBy({
      by: ["planId"],
      where: { planId: { in: planIds }, status: SubscriptionStatus.ACTIVE },
      _count: { _all: true }
    });
    for (const row of grouped as any[]) {
      const planId = String(row?.planId || "");
      if (!planId) continue;
      activeSubsByPlan.set(planId, Number(row?._count?._all || 0));
    }
  }
  res.json({
    items: items.map((p: any) => ({
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
      imageUrl: (p.metadata as any)?.imageUrl || null,
      activeSubscriptions: Number(activeSubsByPlan.get(String(p.id)) || 0),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    })),
    total
  });
});

productsRouter.get("/:id/payments", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
    if (!plan) return res.status(404).json({ error: "not_found" });
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "not_found" });
  }
  const takeRaw = Number(req?.query?.take ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;

  const payments = await prisma.payment.findMany({
    where: { subscription: { planId: id } },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { customer: true, subscription: { include: { plan: true } } }
  });

  res.json({
    items: payments.map((p: any) => ({
      id: p.id,
      amountInCents: p.amountInCents,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      reference: p.reference,
      customerId: p.customerId,
      customerName: p.customer?.name || p.customer?.email || null,
      planName: p.subscription?.plan?.name || null
    }))
  });
});

productsRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return res.status(404).json({ error: "not_found" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "not_found" });
  }
  if ((plan.metadata as any)?.kind !== "CATALOG_ITEM") return res.status(404).json({ error: "not_found" });

  res.json({
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
      taxPercent: (plan.metadata as any)?.taxPercent || 0,
      discountType: (plan.metadata as any)?.discountType || "NONE",
      discountValueInCents: (plan.metadata as any)?.discountValueInCents || 0,
      discountPercent: (plan.metadata as any)?.discountPercent || 0,
      option1Name: (plan.metadata as any)?.option1Name || null,
      option2Name: (plan.metadata as any)?.option2Name || null,
      variants: (plan.metadata as any)?.variants || null,
      imageUrl: (plan.metadata as any)?.imageUrl || null,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }
  });
});

const updateProductSchema = createProductSchema.extend({
  primaryTenantId: z.string().uuid().optional().or(z.literal(""))
});

productsRouter.put("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const tenantId = await getEffectiveTenantId(req);

  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data = parsed.data;
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "not_found" });
  }
  if ((existing.metadata as any)?.kind !== "CATALOG_ITEM") return res.status(404).json({ error: "not_found" });

  const sku = String(data.sku || "").trim();
  if (sku) {
    const clash = await prisma.subscriptionPlan.findFirst({
      where: { id: { not: id }, metadata: { path: ["sku"], equals: sku } } as any
    });
    if (clash) return res.status(409).json({ error: "sku_exists" });
  }

  const mergedMetadata = {
    ...(existing.metadata && typeof existing.metadata === "object" ? (existing.metadata as any) : {}),
    kind: "CATALOG_ITEM",
    sku: data.sku,
    displayName: data.name,
    itemKind: data.kind,
    collectionMode: (data.metadata as any)?.collectionMode || (existing.metadata as any)?.collectionMode || "AUTO_LINK",
    description: data.description || null,
    vendor: data.vendor || null,
    productType: data.productType || null,
    tags: data.tags || null,
    unit: data.unit || null,
    taxable: data.taxable,
    requiresShipping: data.requiresShipping,
    taxPercent: data.taxPercent,
    discountType: data.discountType,
    discountValueInCents: data.discountValueInCents,
    discountPercent: data.discountPercent,
    option1Name: data.option1Name || null,
    option2Name: data.option2Name || null,
    variants: data.variants ? (data.variants as any) : null,
    imageUrl: data.imageUrl || null
  };

  const requestedTenantIds = readTenantIdsFromReq(req);
  const requestedPrimaryTenantId = String((data as any)?.primaryTenantId || "").trim();
  if (requestedPrimaryTenantId && requestedTenantIds.length && !requestedTenantIds.includes(requestedPrimaryTenantId)) {
    return res.status(400).json({ error: "primary_tenant_not_in_list" });
  }
  const primaryTenantId = requestedPrimaryTenantId || requestedTenantIds[0] || existing.tenantId || null;
  const dataForSave: any = { ...(data as any) };
  delete dataForSave.primaryTenantId;

  const updated = await prisma.subscriptionPlan.update({
    where: { id },
    data: {
      ...(primaryTenantId ? { tenantId: primaryTenantId } : {}),
      name: `[${dataForSave.sku}] ${dataForSave.name}`,
      currency: dataForSave.currency,
      priceInCents: dataForSave.basePriceInCents,
      intervalUnit: dataForSave.intervalUnit ?? PlanIntervalUnit.MONTH,
      intervalCount: dataForSave.intervalCount ?? 1,
      metadata: mergedMetadata as any
    }
  });

  // Sync price/interval to plans that depend on this catalog item.
  const plansToUpdate = await prisma.subscriptionPlan.findMany({
    where: { metadata: { path: ["catalog", "itemId"], equals: id } as any }
  });
  if (plansToUpdate.length) {
    await Promise.all(
      plansToUpdate.map((plan: any) => {
        const meta: any = plan.metadata && typeof plan.metadata === "object" ? plan.metadata : {};
        const variantDelta = Number(meta?.catalog?.variantDeltaInCents || 0);
        const totals = computeTotalsForCatalog({
          basePriceInCents: data.basePriceInCents,
          variantDeltaInCents: variantDelta,
          discountType: dataForSave.discountType,
          discountValueInCents: dataForSave.discountValueInCents,
          discountPercent: dataForSave.discountPercent,
          taxPercent: dataForSave.taxPercent
        });
        const nextMeta = {
          ...meta,
          catalog: {
            ...(meta.catalog || {}),
            itemId: id,
            sku: dataForSave.sku,
            name: dataForSave.name,
            kind: dataForSave.kind,
            option1Name: dataForSave.option1Name || null,
            option2Name: dataForSave.option2Name || null
          },
          pricing: {
            ...(meta.pricing || {}),
            basePriceInCents: dataForSave.basePriceInCents,
            discountType: dataForSave.discountType,
            discountValueInCents: dataForSave.discountValueInCents,
            discountPercent: dataForSave.discountPercent,
            taxPercent: dataForSave.taxPercent,
            totalInCents: totals.totalInCents
          }
        };
        return prisma.subscriptionPlan.update({
          where: { id: plan.id },
          data: {
            priceInCents: totals.totalInCents,
            intervalUnit: dataForSave.intervalUnit ?? PlanIntervalUnit.MONTH,
            intervalCount: dataForSave.intervalCount ?? 1,
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

  res.json({ ok: true, id: updated.id });
});

productsRouter.post("/", async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[Products/Create] Validación fallida', {
      error: parsed.error.flatten(),
      body: req.body
    });
    return res.status(400).json({ error: "cuerpo_invalido", detalles: parsed.error.flatten() });
  }

  const data = parsed.data;
  const tenantIds = await getEffectiveTenantIds(req);
  if (!tenantIds.length) {
    console.error('[Products/Create] Tenant requerido pero no proporcionado');
    return res.status(400).json({ error: "tenant_requerido", mensaje: "Debe pertenecer al menos a un tenant" });
  }
  const primaryTenantId = tenantIds[0];
  
  // FIX: Validar SKU duplicado (case-insensitive)
  const skuNormalizado = data.sku.trim().toUpperCase();
  const existing = await prisma.subscriptionPlan.findFirst({
    where: { 
      metadata: { path: ["sku"], equals: skuNormalizado },
      ...(primaryTenantId ? { tenantId: primaryTenantId } : {})
    } as any
  });
  if (existing) {
    console.warn('[Products/Create] SKU duplicado', {
      sku: skuNormalizado,
      existingProductId: existing.id,
      newProductName: data.name
    });
    return res.status(409).json({ 
      error: "sku_ya_existe",
      mensaje: `El SKU ${skuNormalizado} ya está registrado en el sistema`,
      productId: existing.id
    });
  }

  // FIX: Validar coherencia de intervalo
  if (data.intervalUnit === PlanIntervalUnit.CUSTOM && data.intervalCount <= 0) {
    console.error('[Products/Create] Intervalo CUSTOM inválido', {
      intervalUnit: data.intervalUnit,
      intervalCount: data.intervalCount
    });
    return res.status(400).json({
      error: "intervalo_invalido",
      mensaje: "El intervalo CUSTOM debe tener un intervalCount mayor a 0"
    });
  }

  // FIX: Validar variants sin precio negativo
  if (data.variants && data.variants.length > 0) {
    const variantNegativo = data.variants.find(v => v.priceDeltaInCents < 0);
    if (variantNegativo) {
      console.error('[Products/Create] Variante con precio negativo', {
        sku: skuNormalizado,
        variant: variantNegativo
      });
      return res.status(400).json({
        error: "variante_invalida",
        mensaje: "Las variantes no pueden tener priceDeltaInCents negativo"
      });
    }
  }

  try {
    const product = await prisma.subscriptionPlan.create({
      data: {
        tenantId: primaryTenantId,
        name: `[${skuNormalizado}] ${data.name}`,
        currency: normalizeCurrencyCode(data.currency) || DEFAULT_CURRENCY,
        priceInCents: data.basePriceInCents,
        intervalUnit: data.intervalUnit ?? PlanIntervalUnit.MONTH,
        intervalCount: data.intervalCount ?? 1,
        metadata: {
          ...(data.metadata && typeof data.metadata === "object" ? (data.metadata as any) : {}),
          kind: "CATALOG_ITEM",
          sku: skuNormalizado,
          displayName: data.name,
          itemKind: data.kind,
          collectionMode: (data.metadata as any)?.collectionMode || "AUTO_LINK",
          description: data.description || null,
          vendor: data.vendor || null,
          productType: data.productType || null,
          tags: data.tags || null,
          unit: data.unit || null,
          taxable: data.taxable,
          requiresShipping: data.requiresShipping,
          taxPercent: data.taxPercent,
          discountType: data.discountType,
          discountValueInCents: data.discountValueInCents,
          discountPercent: data.discountPercent,
          option1Name: data.option1Name || null,
          option2Name: data.option2Name || null,
          variants: data.variants ? (data.variants as any) : null,
          imageUrl: data.imageUrl || null
        } as any
      }
    });
    await prisma.subscriptionPlanTenant.createMany({
      data: tenantIds.map((t) => ({ planId: product.id, tenantId: t })),
      skipDuplicates: true
    });
    console.log('[Products/Create] Producto creado exitosamente', {
      productId: product.id,
      sku: skuNormalizado,
      tenantIds
    });
    res.status(201).json({ product: { id: product.id } });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      console.error('[Products/Create] Violación de unicidad en BD', {
        sku: skuNormalizado,
        constraint: err?.meta?.target || 'desconocida'
      });
      return res.status(409).json({ 
        error: "registro_duplicado",
        mensaje: "Ya existe un registro con estos datos",
        constraint: err?.meta?.target || 'desconocida'
      });
    }
    console.error('[Products/Create] Error creando producto', {
      sku: skuNormalizado,
      error: err?.message || String(err),
      stack: err?.stack
    });
    throw err;
  }
});

productsRouter.delete("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    console.error('[Products/Delete] ID no proporcionado');
    return res.status(400).json({ error: "id_invalido", mensaje: "El ID del producto es requerido" });
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) {
    console.warn('[Products/Delete] Producto no encontrado', { id });
    return res.status(404).json({ error: "producto_no_encontrado", mensaje: `El producto ${id} no existe` });
  }
  
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) {
      console.warn('[Products/Delete] Acceso denegado', { id, tenantId });
      return res.status(404).json({ error: "producto_no_encontrado", mensaje: "No tienes acceso a este producto" });
    }
  }
  
  if ((plan.metadata as any)?.kind !== "CATALOG_ITEM") {
    console.warn('[Products/Delete] No es un item de catálogo', { id, kind: (plan.metadata as any)?.kind });
    return res.status(404).json({ error: "producto_no_encontrado", mensaje: "El producto no es un item de catálogo" });
  }

  const dependentPlans = await prisma.subscriptionPlan.findMany({
    where: { metadata: { path: ["catalog", "itemId"], equals: id } as any },
    select: { id: true }
  });
  const relatedPlanIds = Array.from(new Set([id, ...dependentPlans.map((p) => p.id)]));
  const blockingStatuses: SubscriptionStatus[] = [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.SUSPENDED
  ];
  const activeBlocking = await prisma.subscription.findMany({
    where: { planId: { in: relatedPlanIds }, status: { in: blockingStatuses } },
    select: { id: true, status: true, customerId: true, planId: true },
    take: 20
  });
  if (activeBlocking.length) {
    console.warn('[Products/Delete] Producto tiene suscripciones activas', {
      id,
      activeCount: activeBlocking.length,
      statuses: blockingStatuses
    });
    return res.status(409).json({
      error: "producto_tiene_suscripciones_activas",
      mensaje: "Debes cancelar suscripciones activas/en mora/suspendidas antes de borrar el producto.",
      detalles: {
        count: activeBlocking.length,
        statuses: blockingStatuses,
        samples: activeBlocking
      }
    });
  }

  const [subscriptionsCount, paymentLinksCount] = await Promise.all([
    prisma.subscription.count({ where: { planId: { in: relatedPlanIds } } }),
    prisma.paymentLink.count({ where: { planId: { in: relatedPlanIds } } })
  ]);

  const force = String((req as any)?.query?.force || "").trim() === "1";
  if (!force && (subscriptionsCount || paymentLinksCount || dependentPlans.length)) {
    console.warn('[Products/Delete] Producto tiene dependencias', {
      id,
      subscriptionsCount,
      paymentLinksCount,
      dependentPlansCount: dependentPlans.length,
      force
    });
    return res.status(409).json({
      error: "producto_tiene_dependencias",
      mensaje: "El producto tiene registros relacionados",
      detalles: { subscriptionsCount, paymentLinksCount, dependentPlansCount: dependentPlans.length }
    });
  }

  try {
    if (force) {
      console.log('[Products/Delete] Iniciando eliminación en cascada', { id });
      const subs = await prisma.subscription.findMany({ where: { planId: { in: relatedPlanIds } }, select: { id: true } });
      const subIds = subs.map((s: any) => s.id);
      const payments = await prisma.payment.findMany({ where: { subscriptionId: { in: subIds } }, select: { id: true } });
      const paymentIds = payments.map((p: any) => p.id);

      if (paymentIds.length) {
        await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
      }
      await prisma.chatwootMessage.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
      await prisma.paymentLink
        .deleteMany({ where: { OR: [{ subscriptionId: { in: subIds } }, { planId: { in: relatedPlanIds } }] } })
        .catch(() => {});
      await prisma.payment.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
      await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch(() => {});
      await prisma.subscription.deleteMany({ where: { id: { in: subIds } } }).catch(() => {});
      await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: { in: relatedPlanIds } } }).catch(() => {});
      await prisma.subscriptionPlan.deleteMany({ where: { id: { in: relatedPlanIds } } }).catch(() => {});
      console.log('[Products/Delete] Eliminación en cascada completada', {
        id,
        subscriptionsDeleted: subIds.length,
        plansDeleted: relatedPlanIds.length
      });
    } else {
      await prisma.subscriptionPlan.delete({ where: { id } });
    }
    await systemLog(LogLevel.INFO, "products.delete", "Catalog item deleted", {
      productId: id,
      relatedPlanIds,
      dependentPlansCount: dependentPlans.length
    }).catch((err) => {
      console.error('[Products/Delete] Fallo creando systemLog', { id, error: err?.message });
    });
    console.log('[Products/Delete] Producto eliminado exitosamente', { id, force });
    res.json({ ok: true });
  } catch (err: any) {
    if (String(err?.code) === "P2025") {
      console.warn('[Products/Delete] Producto ya no existe', { id });
      return res.status(404).json({ error: "producto_no_encontrado", mensaje: "El producto ya fue eliminado" });
    }
    if (String(err?.code) === "P2003") {
      console.error('[Products/Delete] Violación de clave foránea', {
        id,
        constraint: err?.meta?.constraint_name || 'desconocida'
      });
      return res.status(409).json({ error: "producto_tiene_dependencias", mensaje: "El producto tiene registros relacionados que impiden su eliminación" });
    }
    console.error('[Products/Delete] Error eliminando producto', {
      id,
      error: err?.message || String(err),
      stack: err?.stack
    });
    res.status(500).json({ error: "fallo_eliminacion", mensaje: "No se pudo eliminar el producto" });
  }
});
