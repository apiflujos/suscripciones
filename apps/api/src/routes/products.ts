import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";

const variantRowSchema = z.object({
  option1: z.string().optional().nullable(),
  option2: z.string().optional().nullable(),
  priceDeltaInCents: z.number().int()
});

const createProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  kind: z.enum(["PRODUCT", "SERVICE"]).optional().default("PRODUCT"),
  currency: z.string().min(3).max(3).optional().default("COP"),
  basePriceInCents: z.number().int().nonnegative(),
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
  metadata: z.any().optional()
});

export const productsRouter = express.Router();

productsRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const takeRaw = Number(req?.query?.take ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 1000) : 200;
  const skipRaw = Number(req?.query?.skip ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(req?.query?.q ?? "").trim();

  const where: any = { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } as any;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { metadata: { path: ["displayName"], string_contains: q } } as any,
      { metadata: { path: ["sku"], string_contains: q } } as any
    ];
  }

  const items = await prisma.subscriptionPlan.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip
  });
  res.json({
    items: items.map((p) => ({
      id: p.id,
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
      taxPercent: (p.metadata as any)?.taxPercent || 0,
      discountType: (p.metadata as any)?.discountType || "NONE",
      discountValueInCents: (p.metadata as any)?.discountValueInCents || 0,
      discountPercent: (p.metadata as any)?.discountPercent || 0,
      option1Name: (p.metadata as any)?.option1Name || null,
      option2Name: (p.metadata as any)?.option2Name || null,
      variants: (p.metadata as any)?.variants || null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }))
  });
});

productsRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) return res.status(404).json({ error: "not_found" });
  if ((plan.metadata as any)?.kind !== "CATALOG_ITEM") return res.status(404).json({ error: "not_found" });

  res.json({
    item: {
      id: plan.id,
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
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }
  });
});

const updateProductSchema = createProductSchema.extend({});

productsRouter.put("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data = parsed.data;
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "not_found" });
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
    variants: data.variants ? (data.variants as any) : null
  };

  const updated = await prisma.subscriptionPlan.update({
    where: { id },
    data: {
      name: `[${data.sku}] ${data.name}`,
      currency: data.currency,
      priceInCents: data.basePriceInCents,
      intervalUnit: "CUSTOM" as any,
      intervalCount: 1,
      metadata: mergedMetadata as any
    }
  });

  res.json({ ok: true, id: updated.id });
});

productsRouter.post("/", async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const data = parsed.data;
  const existing = await prisma.subscriptionPlan.findFirst({
    where: { metadata: { path: ["sku"], equals: data.sku } } as any
  });
  if (existing) return res.status(409).json({ error: "sku_exists" });

  const product = await prisma.subscriptionPlan.create({
    data: {
      name: `[${data.sku}] ${data.name}`,
      currency: data.currency,
      priceInCents: data.basePriceInCents,
      intervalUnit: "CUSTOM" as any,
      intervalCount: 1,
      metadata: {
        ...(data.metadata && typeof data.metadata === "object" ? (data.metadata as any) : {}),
        kind: "CATALOG_ITEM",
        sku: data.sku,
        displayName: data.name,
        itemKind: data.kind,
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
        variants: data.variants ? (data.variants as any) : null
      } as any
    }
  });
  res.status(201).json({ product: { id: product.id } });
});
