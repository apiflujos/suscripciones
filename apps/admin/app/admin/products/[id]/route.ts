import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { LogLevel, PlanIntervalUnit, SubscriptionStatus } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { reqToCompat } from "../../_lib/reqCompat";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { getEffectiveTenantId, readTenantIdsFromReq } from "@suscripciones/core/services/tenantContext";
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from "@suscripciones/core/lib/currencies";
import { getPublicBaseUrlFromEnv } from "@suscripciones/core/services/publicBase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const updateProductSchema = createProductSchema.extend({
  primaryTenantId: z.string().uuid().optional().or(z.literal(""))
});

function buildPublicBase(req: Request) {
  const envBase = getPublicBaseUrlFromEnv();
  if (envBase) return envBase;
  const host = String(req.headers.get("x-forwarded-host") || req.headers.get("host") || "").trim();
  if (!host) return "";
  const proto = String(req.headers.get("x-forwarded-proto") || "https").trim();
  return `${proto}://${host}`;
}

function normalizeImageUrl(req: Request, raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  if (!value.includes("/") && /\.(jpe?g|png|webp|gif)$/i.test(value)) {
    const base = buildPublicBase(req);
    return base ? `${base}/public/media/${value}` : `/public/media/${value}`;
  }
  return null;
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) return Response.json({ error: "not_found" }, { status: 404 });

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return Response.json({ error: "not_found" }, { status: 404 });
  }
  if ((plan.metadata as any)?.kind !== "CATALOG_ITEM") return Response.json({ error: "not_found" }, { status: 404 });

  return Response.json({
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
      imageUrl: normalizeImageUrl(req, (plan.metadata as any)?.imageUrl),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) return Response.json({ error: "invalid_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;
  const compatReq = reqToCompat(req, body);
  const tenantId = await getEffectiveTenantId(compatReq);

  const existing = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
  if (tenantId) {
    const allowed = existing.tenantId === tenantId || (existing.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return Response.json({ error: "not_found" }, { status: 404 });
  }
  if ((existing.metadata as any)?.kind !== "CATALOG_ITEM") return Response.json({ error: "not_found" }, { status: 404 });

  const skuRaw = String(data.sku || "").trim();
  const skuNormalized = skuRaw ? skuRaw.toUpperCase() : "";
  const existingSku = String((existing.metadata as any)?.sku || "").trim().toUpperCase();
  const requestedTenantIds = readTenantIdsFromReq(compatReq);
  const requestedPrimaryTenantId = String((data as any)?.primaryTenantId || "").trim();
  if (requestedPrimaryTenantId && requestedTenantIds.length && !requestedTenantIds.includes(requestedPrimaryTenantId)) {
    return Response.json({ error: "primary_tenant_not_in_list" }, { status: 400 });
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
    if (clash) return Response.json({ error: "sku_exists" }, { status: 409 });
  }

  const mergedMetadata = {
    ...(existing.metadata && typeof existing.metadata === "object" ? (existing.metadata as any) : {}),
    kind: "CATALOG_ITEM",
    sku: skuNormalized || data.sku,
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
    imageUrl: normalizeImageUrl(req, data.imageUrl)
  };

  const dataForSave: any = { ...(data as any) };
  delete dataForSave.primaryTenantId;

  const updated = await prisma.subscriptionPlan.update({
    where: { id },
    data: {
      ...(primaryTenantId ? { tenantId: primaryTenantId } : {}),
      name: `[${skuNormalized || dataForSave.sku}] ${dataForSave.name}`,
      currency: dataForSave.currency,
      priceInCents: dataForSave.basePriceInCents,
      intervalUnit: dataForSave.intervalUnit ?? PlanIntervalUnit.MONTH,
      intervalCount: dataForSave.intervalCount ?? 1,
      metadata: mergedMetadata as any
    }
  });

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

  return Response.json({ ok: true, id: updated.id });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const id = String(params?.id || "").trim();
  if (!id) {
    console.error("[Products/Delete] ID no proporcionado");
    return Response.json({ error: "id_invalido", mensaje: "El ID del producto es requerido" }, { status: 400 });
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: { tenantLinks: true } });
  if (!plan) {
    console.warn("[Products/Delete] Producto no encontrado", { id });
    return Response.json({ error: "producto_no_encontrado", mensaje: `El producto ${id} no existe` }, { status: 404 });
  }

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  if (tenantId) {
    const allowed = plan.tenantId === tenantId || (plan.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) {
      console.warn("[Products/Delete] Acceso denegado", { id, tenantId });
      return Response.json({ error: "producto_no_encontrado", mensaje: "No tienes acceso a este producto" }, { status: 404 });
    }
  }

  if ((plan.metadata as any)?.kind !== "CATALOG_ITEM") {
    console.warn("[Products/Delete] No es un item de catálogo", { id, kind: (plan.metadata as any)?.kind });
    return Response.json({ error: "producto_no_encontrado", mensaje: "El producto no es un item de catálogo" }, { status: 404 });
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
    console.warn("[Products/Delete] Producto tiene suscripciones activas", {
      id,
      activeCount: activeBlocking.length,
      statuses: blockingStatuses
    });
    return Response.json(
      {
        error: "producto_tiene_suscripciones_activas",
        mensaje: "Debes cancelar suscripciones activas/en mora/suspendidas antes de borrar el producto.",
        detalles: {
          count: activeBlocking.length,
          statuses: blockingStatuses,
          samples: activeBlocking
        }
      },
      { status: 409 }
    );
  }

  const [subscriptionsCount, paymentLinksCount] = await Promise.all([
    prisma.subscription.count({ where: { planId: { in: relatedPlanIds } } }),
    prisma.paymentLink.count({ where: { planId: { in: relatedPlanIds } } })
  ]);

  const url = new URL(req.url);
  const force = String(url.searchParams.get("force") || "").trim() === "1";
  if (!force && (subscriptionsCount || paymentLinksCount || dependentPlans.length)) {
    console.warn("[Products/Delete] Producto tiene dependencias", {
      id,
      subscriptionsCount,
      paymentLinksCount,
      dependentPlansCount: dependentPlans.length,
      force
    });
    return Response.json(
      {
        error: "producto_tiene_dependencias",
        mensaje: "El producto tiene registros relacionados",
        detalles: { subscriptionsCount, paymentLinksCount, dependentPlansCount: dependentPlans.length }
      },
      { status: 409 }
    );
  }

  try {
    if (force) {
      console.log("[Products/Delete] Iniciando eliminación en cascada", { id });
      const subs = await prisma.subscription.findMany({ where: { planId: { in: relatedPlanIds } }, select: { id: true } });
      const subIds = subs.map((s: any) => s.id);
      const payments = await prisma.payment.findMany({ where: { subscriptionId: { in: subIds } }, select: { id: true } });
      const paymentIds = payments.map((p: any) => p.id);

      if (paymentIds.length) {
        await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch((err) => {
          console.error("[Products/Delete] Fallo eliminando paymentAttempt", { id, paymentIdsCount: paymentIds.length, error: err?.message });
        });
      }
      await prisma.chatwootMessage.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch((err) => {
        console.error("[Products/Delete] Fallo eliminando chatwootMessage", { id, subscriptionIdsCount: subIds.length, error: err?.message });
      });
      await prisma.paymentLink
        .deleteMany({ where: { OR: [{ subscriptionId: { in: subIds } }, { planId: { in: relatedPlanIds } }] } })
        .catch((err) => {
          console.error("[Products/Delete] Fallo eliminando paymentLink", { id, subscriptionIdsCount: subIds.length, relatedPlanIdsCount: relatedPlanIds.length, error: err?.message });
        });
      await prisma.payment.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch((err) => {
        console.error("[Products/Delete] Fallo eliminando payment", { id, subscriptionIdsCount: subIds.length, error: err?.message });
      });
      await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subIds } } }).catch((err) => {
        console.error("[Products/Delete] Fallo eliminando subscriptionTenant", { id, subscriptionIdsCount: subIds.length, error: err?.message });
      });
      await prisma.subscription.deleteMany({ where: { id: { in: subIds } } }).catch((err) => {
        console.error("[Products/Delete] Fallo eliminando subscription", { id, subscriptionIdsCount: subIds.length, error: err?.message });
      });
      await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: { in: relatedPlanIds } } }).catch((err) => {
        console.error("[Products/Delete] Fallo eliminando subscriptionPlanTenant", { id, relatedPlanIdsCount: relatedPlanIds.length, error: err?.message });
      });
      await prisma.subscriptionPlan.deleteMany({ where: { id: { in: relatedPlanIds } } }).catch((err) => {
        console.error("[Products/Delete] Fallo eliminando subscriptionPlan", { id, relatedPlanIdsCount: relatedPlanIds.length, error: err?.message });
      });
      console.log("[Products/Delete] Eliminación en cascada completada", {
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
      console.error("[Products/Delete] Fallo creando systemLog", { id, error: err?.message });
    });
    console.log("[Products/Delete] Producto eliminado exitosamente", { id, force });
    return Response.json({ ok: true });
  } catch (err: any) {
    if (String(err?.code) === "P2025") {
      console.warn("[Products/Delete] Producto ya no existe", { id });
      return Response.json({ error: "producto_no_encontrado", mensaje: "El producto ya fue eliminado" }, { status: 404 });
    }
    if (String(err?.code) === "P2003") {
      console.error("[Products/Delete] Violación de clave foránea", {
        id,
        constraint: err?.meta?.constraint_name || "desconocida"
      });
      return Response.json(
        {
          error: "producto_tiene_dependencias",
          mensaje: "El producto tiene registros relacionados que impiden su eliminación"
        },
        { status: 409 }
      );
    }
    console.error("[Products/Delete] Error eliminando producto", {
      id,
      error: err?.message || String(err),
      stack: err?.stack
    });
    return Response.json({ error: "fallo_eliminacion", mensaje: "No se pudo eliminar el producto" }, { status: 500 });
  }
}
