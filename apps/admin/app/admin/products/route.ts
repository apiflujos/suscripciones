import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { LogLevel, PlanIntervalUnit } from "@prisma/client";
import { requireAdminToken } from "../_lib/requireAdminToken";
import { reqToCompat } from "../_lib/reqCompat";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { getEffectiveTenantId, getEffectiveTenantIds } from "@suscripciones/core/services/tenantContext";
import { DEFAULT_CURRENCY, isSupportedCurrency, normalizeCurrencyCode } from "@suscripciones/core/lib/currencies";
import { getPublicBaseUrlFromEnv } from "@suscripciones/core/services/publicBase";
import { listCatalogProducts } from "../_services/products";

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

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const url = new URL(req.url);
  const includeInactiveRaw = String(url.searchParams.get("includeInactive") ?? "").trim().toLowerCase();
  const includeInactive = includeInactiveRaw === "1" || includeInactiveRaw === "true" || includeInactiveRaw === "yes";
  const takeRaw = Number(url.searchParams.get("take") ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 1000) : 200;
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(url.searchParams.get("q") ?? "").trim();
  const idsParam = url.searchParams.get("ids");
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (idsParam !== null && (idsEmpty || ids.length === 0)) {
    return Response.json({ items: [], total: 0 });
  }
  const result = await listCatalogProducts({ tenantId, includeInactive, take, skip, q, ids });
  return Response.json({ items: result.items, total: result.total });
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[Products/Create] Validación fallida", {
      error: parsed.error.flatten(),
      body
    });
    return Response.json({ error: "cuerpo_invalido", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const compatReq = reqToCompat(req, body);
  const tenantIds = await getEffectiveTenantIds(compatReq);
  if (!tenantIds.length) {
    console.error("[Products/Create] Tenant requerido pero no proporcionado");
    return Response.json({ error: "tenant_requerido", mensaje: "Debe pertenecer al menos a un tenant" }, { status: 400 });
  }
  const primaryTenantId = tenantIds[0];

  const skuNormalizado = data.sku.trim().toUpperCase();
  const existing = await prisma.subscriptionPlan.findFirst({
    where: {
      metadata: { path: ["sku"], equals: skuNormalizado },
      ...(primaryTenantId ? { tenantId: primaryTenantId } : {})
    } as any
  });
  if (existing) {
    console.warn("[Products/Create] SKU duplicado", {
      sku: skuNormalizado,
      existingProductId: existing.id,
      newProductName: data.name
    });
    return Response.json(
      {
        error: "sku_ya_existe",
        mensaje: `El SKU ${skuNormalizado} ya está registrado en el sistema`,
        productId: existing.id
      },
      { status: 409 }
    );
  }

  if (data.intervalUnit === PlanIntervalUnit.CUSTOM && data.intervalCount <= 0) {
    console.error("[Products/Create] Intervalo CUSTOM inválido", {
      intervalUnit: data.intervalUnit,
      intervalCount: data.intervalCount
    });
    return Response.json(
      {
        error: "intervalo_invalido",
        mensaje: "El intervalo CUSTOM debe tener un intervalCount mayor a 0"
      },
      { status: 400 }
    );
  }

  if (data.variants && data.variants.length > 0) {
    const variantNegativo = data.variants.find((v) => v.priceDeltaInCents < 0);
    if (variantNegativo) {
      console.error("[Products/Create] Variante con precio negativo", {
        sku: skuNormalizado,
        variant: variantNegativo
      });
      return Response.json(
        {
          error: "variante_invalida",
          mensaje: "Las variantes no pueden tener priceDeltaInCents negativo"
        },
        { status: 400 }
      );
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
          imageUrl: normalizeImageUrl(req, data.imageUrl)
        } as any
      }
    });
    await prisma.subscriptionPlanTenant.createMany({
      data: tenantIds.map((t) => ({ planId: product.id, tenantId: t })),
      skipDuplicates: true
    });
    console.log("[Products/Create] Producto creado exitosamente", {
      productId: product.id,
      sku: skuNormalizado,
      tenantIds
    });
    return Response.json({ product: { id: product.id } }, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      console.error("[Products/Create] Violación de unicidad en BD", {
        sku: skuNormalizado,
        constraint: err?.meta?.target || "desconocida"
      });
      return Response.json(
        {
          error: "registro_duplicado",
          mensaje: "Ya existe un registro con estos datos",
          constraint: err?.meta?.target || "desconocida"
        },
        { status: 409 }
      );
    }
    console.error("[Products/Create] Error creando producto", {
      sku: skuNormalizado,
      error: err?.message || String(err),
      stack: err?.stack
    });
    throw err;
  }
}
