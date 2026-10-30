import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { getCatalogProductById } from "../admin/_services/products";
import { listTenants } from "../admin/_services/tenants";
import { getCsrfToken } from "../lib/csrf";

export type ProductItem = {
  id: string;
  tenantId: string | null;
  tenantIds: string[];
  name: string;
  sku: string;
  kind: "PRODUCT" | "SERVICE";
  description: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string | null;
  unit: string | null;
  requiresShipping: boolean;
  currency: string;
  basePriceInCents: number;
  taxPercent: number;
  discountType: "NONE" | "FIXED" | "PERCENT";
  discountValueInCents: number;
  discountPercent: number;
  option1Name: string | null;
  option2Name: string | null;
  variants: Array<{ option1?: string | null; option2?: string | null; priceDeltaInCents: number }> | null;
  imageUrl: string | null;
};

/** Canal con el que se consulta: el super admin ve todo; los demás, solo el suyo. */
export async function getProductScope() {
  const c = await cookies();
  const session = await verifyAdminSessionToken(c.get(ADMIN_SESSION_COOKIE)?.value || "");
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  return { session, isSuperAdmin, scopeTenantId: isSuperAdmin ? null : session?.tenantId || null };
}

export async function listActiveTenants() {
  const tenants = ((await listTenants()) ?? []) as Array<{ id: string; name: string; active?: boolean }>;
  return tenants.filter((t) => t?.active !== false).map((t) => ({ id: String(t.id), name: String(t.name) }));
}

/** Producto de una página dedicada (editar, enviar, crear suscripción, borrar). 404 si no existe. */
export async function loadProduct(productId: string) {
  const { scopeTenantId } = await getProductScope();
  const [res, csrfToken] = await Promise.all([
    getCatalogProductById({ productId, tenantId: scopeTenantId }),
    getCsrfToken()
  ]);
  if (!res.ok || !("item" in res) || !res.item) notFound();
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = res.item as any;
  const item = rest as ProductItem;
  return { item: { ...item, currency: String(item.currency || "COP") }, csrfToken, scopeTenantId };
}
