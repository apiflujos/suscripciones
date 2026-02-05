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
  const items = await prisma.subscriptionPlan.findMany({
    where: { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } as any,
    orderBy: { createdAt: "desc" },
    take: 200
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
