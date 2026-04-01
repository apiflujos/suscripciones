import "server-only";

import { prisma } from "@suscripciones/database";
import { PublicCheckoutKind } from "@prisma/client";

function extractProductId(entry: any): string {
  if (!entry) return "";
  if (typeof entry === "string") return String(entry).trim();
  if (typeof entry === "object") return String(entry?.id || "").trim();
  return "";
}

function templateMatchesProduct(template: any, productId: string) {
  const list = Array.isArray(template?.productIds) ? template.productIds : [];
  return list.some((entry: any) => String(extractProductId(entry)) === String(productId));
}

export async function findCheckoutTemplateForProduct(args: {
  tenantId?: string | null;
  kind: PublicCheckoutKind;
  productId: string;
}) {
  const productId = String(args.productId || "").trim();
  if (!productId) return null;
  const where: any = { active: true, kind: args.kind };
  if (args.tenantId) where.tenantId = args.tenantId;
  const items = await prisma.publicCheckoutTemplate.findMany({ where, orderBy: { updatedAt: "desc" } });
  return items.find((t: any) => templateMatchesProduct(t, productId)) || null;
}

export async function getActiveCheckoutTemplates(args: { tenantId?: string | null; kind?: PublicCheckoutKind }) {
  const where: any = {};
  if (args.tenantId) where.tenantId = args.tenantId;
  if (args.kind) where.kind = args.kind;
  where.active = true;

  const items = await prisma.publicCheckoutTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  return items;
}

export async function listCheckoutTemplates(args: { tenantId?: string | null; wantsAll?: boolean }) {
  const where = args.wantsAll ? undefined : args.tenantId ? { tenantId: args.tenantId } : undefined;
  const items = await prisma.publicCheckoutTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  return items;
}

export async function getCheckoutTemplateById(args: { id: string; tenantId?: string | null }) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false, status: 400, error: "invalid_id" as const };

  const item = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
  if (!item) return { ok: false, status: 404, error: "not_found" as const };
  if (args.tenantId && item.tenantId && item.tenantId !== args.tenantId) return { ok: false, status: 404, error: "not_found" as const };

  return { ok: true, item };
}

export async function createCheckoutTemplate(args: {
  name: string;
  kind: PublicCheckoutKind;
  active?: boolean;
  allowProductSelect?: boolean;
  productIds?: any[];
  tenantId: string;
  expiryHours?: number;
  logoUrl?: string;
  publicTitle?: string;
  publicDescription?: string;
  wompiTitle?: string;
  wompiDescription?: string;
  utmParams?: string;
  layout?: any;
}) {
  const name = String(args.name || "").trim();
  if (!name) return { ok: false, status: 400, error: "invalid_body" as const };
  const kind = args.kind;
  if (!kind) return { ok: false, status: 400, error: "invalid_body" as const };

  const tenantId = String(args.tenantId || "").trim();
  if (!tenantId) return { ok: false, status: 400, error: "invalid_body" as const };
  if (!Array.isArray(args.productIds) || args.productIds.length === 0) {
    return { ok: false, status: 400, error: "product_required" as const };
  }
  if (args.productIds.length > 1) {
    return { ok: false, status: 400, error: "max_one_product" as const };
  }

  const item = await prisma.publicCheckoutTemplate.create({
    data: {
      name,
      kind,
      active: args.active ?? true,
      allowProductSelect: args.allowProductSelect ?? false,
      productIds: args.productIds ?? [],
      tenantId,
      expiryHours: args.expiryHours ?? null,
      logoUrl: args.logoUrl || null,
      publicTitle: args.publicTitle || null,
      publicDescription: args.publicDescription || null,
      wompiTitle: args.wompiTitle || null,
      wompiDescription: args.wompiDescription || null,
      utmParams: args.utmParams || null,
      layout: args.layout ?? undefined
    }
  });
  return { ok: true, item };
}

export async function updateCheckoutTemplate(args: {
  id: string;
  tenantId?: string | null;
  name: string;
  kind: PublicCheckoutKind;
  active?: boolean;
  allowProductSelect?: boolean;
  productIds?: any[];
  expiryHours?: number;
  logoUrl?: string;
  publicTitle?: string;
  publicDescription?: string;
  wompiTitle?: string;
  wompiDescription?: string;
  utmParams?: string;
  layout?: any;
}) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false, status: 400, error: "missing_id" as const };

  const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "not_found" as const };
  if (args.tenantId && existing.tenantId && existing.tenantId !== args.tenantId) return { ok: false, status: 404, error: "not_found" as const };

  const name = String(args.name || "").trim();
  if (!name) return { ok: false, status: 400, error: "invalid_body" as const };
  if (!Array.isArray(args.productIds) || args.productIds.length === 0) {
    return { ok: false, status: 400, error: "product_required" as const };
  }
  if (args.productIds.length > 1) {
    return { ok: false, status: 400, error: "max_one_product" as const };
  }

  const updated = await prisma.publicCheckoutTemplate.update({
    where: { id },
    data: {
      name,
      kind: args.kind,
      active: args.active ?? existing.active,
      allowProductSelect: args.allowProductSelect ?? existing.allowProductSelect,
      productIds: args.productIds ?? (Array.isArray(existing.productIds) ? existing.productIds : []),
      expiryHours: args.expiryHours ?? existing.expiryHours,
      logoUrl: args.logoUrl ?? existing.logoUrl,
      publicTitle: args.publicTitle ?? existing.publicTitle,
      publicDescription: args.publicDescription ?? existing.publicDescription,
      wompiTitle: args.wompiTitle ?? existing.wompiTitle,
      wompiDescription: args.wompiDescription ?? existing.wompiDescription,
      utmParams: args.utmParams ?? existing.utmParams,
      layout: args.layout ?? existing.layout
    }
  });
  return { ok: true, item: updated };
}

export async function deleteCheckoutTemplate(args: { id: string; tenantId?: string | null }) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false, status: 400, error: "missing_id" as const };

  const existing = await prisma.publicCheckoutTemplate.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "not_found" as const };
  if (args.tenantId && existing.tenantId && existing.tenantId !== args.tenantId) return { ok: false, status: 404, error: "not_found" as const };

  await prisma.publicCheckoutTemplate.delete({ where: { id } });
  return { ok: true };
}
