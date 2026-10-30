/** Comprobaciones previas al envío de un producto: qué checkout público le corresponde. */

function templateProductId(entry: any) {
  if (!entry) return "";
  if (typeof entry === "string") return entry.trim();
  if (typeof entry === "object") return String(entry?.id || "").trim();
  return "";
}

function templateMatchesProduct(template: any, productId: string) {
  const list = Array.isArray(template?.productIds) ? template.productIds : [];
  return list.some((entry: any) => templateProductId(entry) === String(productId));
}

function templateMatchesTenant(template: any, tenantId?: string | null) {
  const resolved = String(tenantId || "").trim();
  if (!resolved) return true;
  const templateTenantId = String(template?.tenantId || "").trim();
  return !templateTenantId || templateTenantId === resolved;
}

export function findPlanTemplateForProduct(args: {
  product: { id: string; tenantId?: string | null; tenantIds?: string[] };
  checkoutTemplates: any[];
  checkoutConfig: any;
}) {
  const productId = String(args.product?.id || "").trim();
  const tenantId = String(args.product?.tenantId || args.product?.tenantIds?.[0] || "").trim();
  const candidates = args.checkoutTemplates.filter(
    (t: any) => Boolean(t?.active) && String(t?.kind || "") === "PLAN" && templateMatchesTenant(t, tenantId)
  );
  const exactTenant = candidates.find((t: any) => String(t?.tenantId || "").trim() === tenantId && templateMatchesProduct(t, productId));
  if (exactTenant) return exactTenant;
  const byProduct = candidates.find((t: any) => templateMatchesProduct(t, productId));
  if (byProduct) return byProduct;
  const defaultId = String(args.checkoutConfig?.defaultPlanTemplateId || "").trim();
  if (!defaultId) return null;
  const exactDefault = candidates.find((t: any) => String(t?.tenantId || "").trim() === tenantId && String(t?.id || "").trim() === defaultId);
  if (exactDefault) return exactDefault;
  return candidates.find((t: any) => String(t?.id || "").trim() === defaultId) || null;
}
