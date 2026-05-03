import "server-only";

import { prisma } from "@suscripciones/database";
import { PublicCheckoutKind } from "@prisma/client";
import { listCatalogProducts } from "./products";

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

function templateMatchesTenant(template: any, tenantId?: string | null) {
  const resolvedTenantId = String(tenantId || "").trim();
  if (!resolvedTenantId) return true;
  const templateTenantId = String(template?.tenantId || "").trim();
  return !templateTenantId || templateTenantId === resolvedTenantId;
}

function templateMatchesFallback(args: { template: any; kind: PublicCheckoutKind; tenantId?: string | null; defaultTemplateId?: string | null }) {
  const fallbackId = String(args.defaultTemplateId || "").trim();
  if (!fallbackId) return false;
  if (String(args.template?.id || "").trim() !== fallbackId) return false;
  if (args.template?.active === false) return false;
  if (args.template?.kind !== args.kind) return false;
  return templateMatchesTenant(args.template, args.tenantId);
}

export async function findCheckoutTemplateForProduct(args: {
  tenantId?: string | null;
  kind: PublicCheckoutKind;
  productId: string;
}) {
  const productId = String(args.productId || "").trim();
  if (!productId) return null;
  const items = await prisma.publicCheckoutTemplate.findMany({ where: { active: true, kind: args.kind }, orderBy: { updatedAt: "desc" } });
  return items.find((t: any) => templateMatchesTenant(t, args.tenantId) && templateMatchesProduct(t, productId)) || null;
}

export async function findCheckoutTemplateForProductOrDefault(args: {
  tenantId?: string | null;
  kind: PublicCheckoutKind;
  productId?: string | null;
  defaultTemplateId?: string | null;
}) {
  const resolvedProductId = String(args.productId || "").trim();
  const items = await prisma.publicCheckoutTemplate.findMany({ where: { active: true, kind: args.kind }, orderBy: { updatedAt: "desc" } });

  if (resolvedProductId) {
    const matched = items.find((t: any) => templateMatchesTenant(t, args.tenantId) && templateMatchesProduct(t, resolvedProductId)) || null;
    if (matched) return matched;
  }

  const localFallback = items.find((t: any) => templateMatchesFallback({ template: t, kind: args.kind, tenantId: args.tenantId, defaultTemplateId: args.defaultTemplateId }));
  if (localFallback) return localFallback;

  const fallbackId = String(args.defaultTemplateId || "").trim();
  if (!fallbackId) return null;
  const fallback = await prisma.publicCheckoutTemplate.findUnique({ where: { id: fallbackId } });
  if (!fallback) return null;
  return templateMatchesFallback({ template: fallback, kind: args.kind, tenantId: args.tenantId, defaultTemplateId: fallbackId }) ? fallback : null;
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
  if (kind !== PublicCheckoutKind.CART && args.productIds.length > 1) {
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
  if (args.kind !== PublicCheckoutKind.CART && args.productIds.length > 1) {
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

export async function listCheckoutSelectableProducts(args: {
  template: { kind: PublicCheckoutKind; tenantId?: string | null; allowProductSelect?: boolean; productIds?: any };
}) {
  const template = args.template;
  const configuredIds = Array.from(
    new Set(
      (Array.isArray(template.productIds) ? template.productIds : [])
        .map((entry: any) => {
          if (typeof entry === "string") return String(entry).trim();
          if (entry && typeof entry === "object") return String(entry.id || "").trim();
          return "";
        })
        .filter(Boolean)
    )
  );

  if (template.kind === PublicCheckoutKind.CART && template.allowProductSelect) {
    return listCatalogProducts({ tenantId: template.tenantId || null, take: 500 });
  }

  if (!configuredIds.length) return { items: [], total: 0 };
  return listCatalogProducts({ tenantId: template.tenantId || null, ids: configuredIds, take: configuredIds.length });
}
