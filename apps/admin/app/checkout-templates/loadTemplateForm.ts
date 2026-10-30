import { notFound } from "next/navigation";
import { getCheckoutTemplateById } from "../admin/_services/checkoutTemplates";
import { listCatalogProducts } from "../admin/_services/products";
import { listTenants } from "../admin/_services/tenants";
import { getCsrfToken } from "../lib/csrf";
import type { WizardTemplate } from "./CheckoutTemplateWizard";
import type { TemplateProduct, TemplateTenant } from "./templateErrors";

/** Productos y canales que alimentan el asistente (los mismos que antes recibía el panel). */
export async function loadTemplateFormData() {
  const [productsRes, tenantsRaw, csrfToken] = await Promise.all([
    listCatalogProducts({ take: 200, includeInactive: false }),
    listTenants(),
    getCsrfToken()
  ]);
  const products: TemplateProduct[] = ((productsRes?.items ?? []) as any[]).map((p: any) => ({
    id: String(p.id),
    name: String(p.name || "Producto"),
    sku: p.sku ? String(p.sku) : undefined,
    metadata: p.metadata && typeof p.metadata === "object" ? { sku: (p.metadata as any).sku } : undefined,
    collectionMode: p.collectionMode ? String(p.collectionMode) : undefined
  }));
  const tenants: TemplateTenant[] = ((tenantsRaw ?? []) as any[])
    .filter((t: any) => t?.active !== false)
    .map((t: any) => ({ id: String(t.id), name: String(t.name) }));
  return { products, tenants, csrfToken };
}

/** Una plantilla lista para el asistente; 404 si no existe. */
export async function loadTemplateForEdit(id: string): Promise<WizardTemplate> {
  const res: any = await getCheckoutTemplateById({ id });
  const t = res?.ok ? res.item : null;
  if (!t) notFound();
  return {
    id: String(t.id),
    name: String(t.name || ""),
    kind: t.kind,
    active: Boolean(t.active),
    tenantId: t.tenantId ? String(t.tenantId) : null,
    allowProductSelect: Boolean(t.allowProductSelect),
    productIds: t.productIds ?? [],
    expiryHours: t.expiryHours ?? null,
    logoUrl: t.logoUrl ?? null,
    publicTitle: t.publicTitle ?? null,
    publicDescription: t.publicDescription ?? null,
    wompiTitle: t.wompiTitle ?? null,
    wompiDescription: t.wompiDescription ?? null,
    utmParams: t.utmParams ?? null,
    layout: t.layout ?? null
  };
}
