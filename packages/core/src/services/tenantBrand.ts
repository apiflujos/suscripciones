import { prisma } from "../db/prisma";

export type TenantBrand = {
  id: string;
  name: string;
  logoUrl: string | null;
};

function normalizeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "null" || lowered === "undefined") return null;
  return trimmed;
}

function extractLogoUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, any>;
  const brand = meta.brand && typeof meta.brand === "object" ? meta.brand : {};
  const assets = meta.assets && typeof meta.assets === "object" ? meta.assets : {};

  const candidates = [
    meta.logoUrl,
    meta.logo_url,
    meta.logo,
    brand.logoUrl,
    brand.logo_url,
    brand.logo,
    brand.primaryLogo,
    brand.primaryLogoUrl,
    brand.horizontalLogo,
    brand.horizontalLogoUrl,
    brand.logoHorizontal,
    brand.logoVertical,
    assets.logoUrl,
    assets.logo,
    assets.logoHorizontal,
    assets.logoVertical
  ];

  for (const candidate of candidates) {
    const normalized = normalizeLogoUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export async function getTenantBrand(tenantId?: string | null): Promise<TenantBrand | null> {
  if (!tenantId) return null;
  const tenant = await prisma.saTenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, metadata: true }
  });
  if (!tenant) return null;
  return {
    id: tenant.id,
    name: tenant.name,
    logoUrl: extractLogoUrl(tenant.metadata)
  };
}
