import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { Prisma, PublicCheckoutKind } from "@prisma/client";
import { getEffectiveTenantId } from "../services/tenantContext";

const layoutSchema = z
  .object({
    primaryColor: z.string().optional().or(z.literal("")),
    fontFamily: z.string().optional().or(z.literal("")),
    supportEmail: z.string().optional().or(z.literal("")),
    supportUrl: z.string().optional().or(z.literal("")),
    ctaLabel: z.string().optional().or(z.literal("")),
    fields: z
      .object({
        showName: z.boolean().optional(),
        showPhone: z.boolean().optional(),
        showEmail: z.boolean().optional()
      })
      .optional()
  })
  .optional();

const kindSchema = z.preprocess((v) => {
  const s = String(v || "").trim().toUpperCase();
  if (s === "SUBSCRIPCION") return "SUBSCRIPTION";
  return s;
}, z.nativeEnum(PublicCheckoutKind));

const productIdsSchema = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return v;
}, z.array(z.string()).optional());

const templateSchema = z.object({
  name: z.string().min(1),
  kind: kindSchema,
  active: z.boolean().optional(),
  allowProductSelect: z.boolean().optional(),
  productIds: productIdsSchema,
  expiryHours: z.coerce.number().int().positive().optional(),
  logoUrl: z.string().optional().or(z.literal("")),
  publicTitle: z.string().optional().or(z.literal("")),
  publicDescription: z.string().optional().or(z.literal("")),
  wompiTitle: z.string().optional().or(z.literal("")),
  wompiDescription: z.string().optional().or(z.literal("")),
  utmParams: z.string().optional().or(z.literal("")),
  layout: layoutSchema
});

export const checkoutTemplatesRouter = express.Router();

checkoutTemplatesRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const rawTenant = String(req?.query?.tenantId || req?.body?.tenantId || req?.headers?.["x-tenant-id"] || "").trim();
  const wantsAll = rawTenant.toLowerCase() === "all";
  const tenantId = wantsAll ? null : await getEffectiveTenantId(req);
  const items = await prisma.publicCheckoutTemplate.findMany({
    where: tenantId ? { tenantId } : undefined,
    orderBy: { createdAt: "desc" }
  });
  res.json({ items });
});

checkoutTemplatesRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const tenantId = await getEffectiveTenantId(req);
  const item = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "not_found" });
  if (tenantId && item.tenantId && item.tenantId !== tenantId) return res.status(404).json({ error: "not_found" });
  res.json({ item });
});

checkoutTemplatesRouter.post("/", async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const data = parsed.data;

  const hasProducts = Array.isArray(data.productIds) && data.productIds.length > 0;
  if (!data.allowProductSelect && !hasProducts) {
    return res.status(400).json({ error: "product_required" });
  }
  if (String(data.kind) === "CART" && data.productIds?.length) {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { id: { in: data.productIds } },
      select: { id: true, metadata: true }
    });
    let hasPlan = false;
    let hasSub = false;
    for (const p of plans) {
      const mode = String((p.metadata as any)?.collectionMode || "");
      if (!mode || mode === "AUTO_LINK") hasPlan = true;
      if (mode === "AUTO_DEBIT") hasSub = true;
      if (hasPlan && hasSub) break;
    }
    if (hasPlan && hasSub) {
      return res.status(400).json({ error: "cart_mixed_collection" });
    }
  }

  const tenantId = await getEffectiveTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_required" });
  const created = await prisma.publicCheckoutTemplate.create({
    data: {
      tenantId,
      name: data.name,
      kind: data.kind,
      active: data.active ?? true,
      allowProductSelect: data.allowProductSelect ?? false,
      productIds: data.productIds || [],
      expiryHours: data.expiryHours ?? null,
      logoUrl: data.logoUrl || null,
      publicTitle: data.publicTitle || null,
      publicDescription: data.publicDescription || null,
      wompiTitle: data.wompiTitle || null,
      wompiDescription: data.wompiDescription || null,
      utmParams: data.utmParams || null,
      layout: data.layout ?? Prisma.JsonNull
    }
  });

  res.status(201).json({ template: created });
});

checkoutTemplatesRouter.put("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const data = parsed.data;

  const hasProducts = Array.isArray(data.productIds) && data.productIds.length > 0;
  if (!data.allowProductSelect && !hasProducts) {
    return res.status(400).json({ error: "product_required" });
  }
  if (String(data.kind) === "CART" && data.productIds?.length) {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { id: { in: data.productIds } },
      select: { id: true, metadata: true }
    });
    let hasPlan = false;
    let hasSub = false;
    for (const p of plans) {
      const mode = String((p.metadata as any)?.collectionMode || "");
      if (!mode || mode === "AUTO_LINK") hasPlan = true;
      if (mode === "AUTO_DEBIT") hasSub = true;
      if (hasPlan && hasSub) break;
    }
    if (hasPlan && hasSub) {
      return res.status(400).json({ error: "cart_mixed_collection" });
    }
  }

  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
    if (!existing || (existing.tenantId && existing.tenantId !== tenantId)) return res.status(404).json({ error: "not_found" });
  }
  const updated = await prisma.publicCheckoutTemplate.update({
    where: { id },
    data: {
      name: data.name,
      kind: data.kind,
      active: data.active ?? true,
      allowProductSelect: data.allowProductSelect ?? false,
      productIds: data.productIds || [],
      expiryHours: data.expiryHours ?? null,
      logoUrl: data.logoUrl || null,
      publicTitle: data.publicTitle || null,
      publicDescription: data.publicDescription || null,
      wompiTitle: data.wompiTitle || null,
      wompiDescription: data.wompiDescription || null,
      utmParams: data.utmParams || null,
      layout: data.layout ?? Prisma.JsonNull
    }
  });
  res.json({ template: updated });
});

checkoutTemplatesRouter.delete("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const tenantId = await getEffectiveTenantId(req);
  if (tenantId) {
    const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
    if (!existing || (existing.tenantId && existing.tenantId !== tenantId)) return res.status(404).json({ error: "not_found" });
  }
  await prisma.publicCheckoutTemplate.delete({ where: { id } });
  res.json({ ok: true });
});
