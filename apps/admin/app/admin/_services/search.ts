import "server-only";

import { prisma } from "@suscripciones/database";

function normalize(input: unknown) {
  return String(input || "").trim();
}

export async function searchProducts(args: { q: string; take: number; tenantId?: string | null }) {
  const q = normalize(args.q);
  const take = Number.isFinite(args.take) ? Math.min(Math.max(Math.trunc(args.take), 1), 500) : 50;
  const where: any = { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } as any;
  if (args.tenantId) {
    where.AND = [{ OR: [{ tenantId: args.tenantId }, { tenantLinks: { some: { tenantId: args.tenantId } } }] }];
  }
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
    include: { tenantLinks: true }
  });

  return items.map((p: any) => {
    const meta = p.metadata && typeof p.metadata === "object" ? (p.metadata as any) : {};
    return {
      id: p.id,
      tenantId: p.tenantId || null,
      tenantIds: Array.from(new Set([p.tenantId, ...(p.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean))),
      name: meta.displayName || p.name,
      sku: meta.sku || "",
      kind: meta.itemKind || "PRODUCT",
      description: meta.description || null,
      vendor: meta.vendor || null,
      productType: meta.productType || null,
      tags: meta.tags || null,
      unit: meta.unit || null,
      taxable: meta.taxable ?? true,
      requiresShipping: meta.requiresShipping ?? false,
      currency: p.currency,
      basePriceInCents: p.priceInCents,
      intervalUnit: p.intervalUnit,
      intervalCount: p.intervalCount,
      taxPercent: meta.taxPercent ?? 0,
      discountType: meta.discountType || "NONE",
      discountValueInCents: meta.discountValueInCents || 0,
      discountPercent: meta.discountPercent || 0,
      option1Name: meta.option1Name || null,
      option2Name: meta.option2Name || null,
      variants: Array.isArray(meta.variants) ? meta.variants : [],
      imageUrl: meta.imageUrl || null
    };
  });
}

export async function searchCustomers(args: { q: string; take: number; tenantId?: string | null }) {
  const q = normalize(args.q);
  const take = Number.isFinite(args.take) ? Math.min(Math.max(Math.trunc(args.take), 1), 200) : 50;
  if (!q) return [];

  const digits = q.replace(/[^\d]/g, "");
  const where: any = {};
  if (args.tenantId) {
    where.AND = [{ OR: [{ tenantId: args.tenantId }, { tenantLinks: { some: { tenantId: args.tenantId } } }] }];
  }
  const or: any[] = [
    { name: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } }
  ];
  if (digits.length >= 4) {
    or.push({ phone: { contains: digits } });
  } else {
    or.push({ phone: { contains: q, mode: "insensitive" } });
  }
  or.push({ metadata: { path: ["identificacion"], string_contains: q } } as any);
  or.push({ metadata: { path: ["identificacionNumero"], string_contains: q } } as any);
  or.push({ metadata: { path: ["identificationNumber"], string_contains: q } } as any);
  or.push({ metadata: { path: ["documentNumber"], string_contains: q } } as any);
  or.push({ metadata: { path: ["document"], string_contains: q } } as any);
  where.OR = or;

  const items = await prisma.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: { tenantLinks: true }
  });
  return items.map((c: any) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    metadata: c.metadata,
    tenantId: c.tenantId || null,
    tenantIds: Array.from(new Set([c.tenantId, ...(c.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean)))
  }));
}

export async function searchPlans(args: { q: string; take: number; tenantId?: string | null }) {
  const q = normalize(args.q);
  const take = Number.isFinite(args.take) ? Math.min(Math.max(Math.trunc(args.take), 1), 500) : 80;

  const where: any = { NOT: { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } } as any;
  const and: any[] = [];
  if (args.tenantId) {
    const tenantFilter = { OR: [{ tenantId: args.tenantId }, { tenantLinks: { some: { tenantId: args.tenantId } } }] };
    and.push(tenantFilter);
  }
  if (and.length) where.AND = and;

  const rawItems = await prisma.subscriptionPlan.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q ? Math.max(take, 2000) : take,
    include: { tenantLinks: true }
  });
  const qNorm = q.toLowerCase();
  const items = q
    ? rawItems
        .filter((p: any) => {
          const md = p?.metadata && typeof p.metadata === "object" ? (p.metadata as any) : {};
          const catalog = md?.catalog && typeof md.catalog === "object" ? md.catalog : {};
          const searchable = [p?.name, p?.id, md?.displayName, md?.sku, catalog?.name, catalog?.title]
            .map((v) => String(v || "").toLowerCase())
            .join(" ");
          return searchable.includes(qNorm);
        })
        .slice(0, take)
    : rawItems;

  return items.map((p: any) => ({
    ...p,
    tenantIds: Array.from(new Set([p.tenantId, ...(p.tenantLinks || []).map((t: any) => t.tenantId)].filter(Boolean)))
  }));
}
