"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import {
  createCheckoutTemplate as createCheckoutTemplateService,
  updateCheckoutTemplate as updateCheckoutTemplateService,
  deleteCheckoutTemplate as deleteCheckoutTemplateService,
  getCheckoutTemplateById,
  listCheckoutTemplates
} from "../admin/_services/checkoutTemplates";
import { listTenants } from "../admin/_services/tenants";
import { getAdminSettings } from "../admin/_services/settings";
import { listCatalogProducts } from "../admin/_services/products";

function redirectWith(action: string, status: "ok" | "fail", error?: string) {
  const qp = new URLSearchParams({ a: action, status, tab: "checkout-publico" });
  if (error) qp.set("error", error);
  redirect(`/settings?${qp.toString()}`);
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function parseProductIds(raw: string): any[] {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createCheckoutTemplate(formData: FormData) {
  try {
    await assertCsrfToken(formData);
    let layout: any = {};
    try {
      layout = JSON.parse(String(formData.get("layout") || "{}"));
    } catch {
      layout = {};
    }
    const name = String(formData.get("name") || "").trim();
    const kind = String(formData.get("kind") || "PLAN").trim().toUpperCase();
    const tenantId = String(formData.get("tenantId") || "").trim();
    if (!name || (kind !== "PLAN" && kind !== "SUBSCRIPTION" && kind !== "CART")) {
      return redirectWith("checkout_template_create", "fail", "invalid_body");
    }
    if (!tenantId) {
      return redirectWith("checkout_template_create", "fail", "tenant_required");
    }

    const allowProductSelect = kind === "CART" ? String(formData.get("allowProductSelect") || "") === "on" : false;
    const productIds = parseProductIds(String(formData.get("productIds") || ""));
    if (!productIds.length) {
      return redirectWith("checkout_template_create", "fail", "product_required");
    }
    if (productIds.length > 1) {
      return redirectWith("checkout_template_create", "fail", "max_one_product");
    }
    const expiryHoursRaw = String(formData.get("expiryHours") || "").trim();
    const expiryHoursNum = expiryHoursRaw ? Number(expiryHoursRaw) : NaN;
    const payload = {
      name,
      kind,
      active: String(formData.get("active") || "") === "on",
      allowProductSelect,
      productIds,
      tenantId,
      expiryHours: Number.isFinite(expiryHoursNum) ? expiryHoursNum : undefined,
      logoUrl: String(formData.get("logoUrl") || "").trim(),
      publicTitle: String(formData.get("publicTitle") || "").trim(),
      publicDescription: String(formData.get("publicDescription") || "").trim(),
      wompiTitle: String(formData.get("wompiTitle") || "").trim(),
      wompiDescription: String(formData.get("wompiDescription") || "").trim(),
      utmParams: String(formData.get("utmParams") || "").trim(),
      layout
    };
    const res = await createCheckoutTemplateService(payload as any);
    if (!res.ok) throw new Error(res.error);
    redirectWith("checkout_template_create", "ok");
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_create", "fail", String(err?.message || "create_failed"));
  }
}

export async function updateCheckoutTemplate(formData: FormData) {
  try {
    await assertCsrfToken(formData);
    const id = String(formData.get("id") || "").trim();
    if (!id) return redirectWith("checkout_template_update", "fail", "missing_id");
    let layout: any = {};
    try {
      layout = JSON.parse(String(formData.get("layout") || "{}"));
    } catch {
      layout = {};
    }
    const name = String(formData.get("name") || "").trim();
    const kind = String(formData.get("kind") || "PLAN").trim().toUpperCase();
    const tenantId = String(formData.get("tenantId") || "").trim();
    if (!name || (kind !== "PLAN" && kind !== "SUBSCRIPTION" && kind !== "CART")) {
      return redirectWith("checkout_template_update", "fail", "invalid_body");
    }
    const allowProductSelect = kind === "CART" ? String(formData.get("allowProductSelect") || "") === "on" : false;
    const productIds = parseProductIds(String(formData.get("productIds") || ""));
    if (!productIds.length) {
      return redirectWith("checkout_template_update", "fail", "product_required");
    }
    if (productIds.length > 1) {
      return redirectWith("checkout_template_update", "fail", "max_one_product");
    }
    const expiryHoursRaw = String(formData.get("expiryHours") || "").trim();
    const expiryHoursNum = expiryHoursRaw ? Number(expiryHoursRaw) : NaN;
    const payload = {
      name,
      kind,
      active: String(formData.get("active") || "") === "on",
      allowProductSelect,
      productIds,
      ...(tenantId ? { tenantId } : {}),
      expiryHours: Number.isFinite(expiryHoursNum) ? expiryHoursNum : undefined,
      logoUrl: String(formData.get("logoUrl") || "").trim(),
      publicTitle: String(formData.get("publicTitle") || "").trim(),
      publicDescription: String(formData.get("publicDescription") || "").trim(),
      wompiTitle: String(formData.get("wompiTitle") || "").trim(),
      wompiDescription: String(formData.get("wompiDescription") || "").trim(),
      utmParams: String(formData.get("utmParams") || "").trim(),
      layout
    };
    const res = await updateCheckoutTemplateService({ id, ...payload } as any);
    if (!res.ok) throw new Error(res.error);
    redirectWith("checkout_template_update", "ok");
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_update", "fail", String(err?.message || "update_failed"));
  }
}

export async function deleteCheckoutTemplate(formData: FormData) {
  try {
    await assertCsrfToken(formData);
    const id = String(formData.get("id") || "").trim();
    if (!id) return redirectWith("checkout_template_delete", "fail", "missing_id");
    const res = await deleteCheckoutTemplateService({ id });
    if (!res.ok) throw new Error(res.error);
    redirectWith("checkout_template_delete", "ok");
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_delete", "fail", String(err?.message || "delete_failed"));
  }
}

export async function duplicateCheckoutTemplate(formData: FormData) {
  try {
    await assertCsrfToken(formData);
    const id = String(formData.get("id") || "").trim();
    if (!id) return redirectWith("checkout_template_duplicate", "fail", "missing_id");
    const existing = await getCheckoutTemplateById({ id });
    const template = existing.ok ? existing.item : null;
    if (!template) return redirectWith("checkout_template_duplicate", "fail", "not_found");
    if (!template.tenantId) return redirectWith("checkout_template_duplicate", "fail", "tenant_required");

    const payload = {
      name: `Copia - ${template.name || "Plantilla"}`,
      kind: template.kind,
      active: template.active,
      allowProductSelect: template.kind === "CART" ? template.allowProductSelect : false,
      productIds: template.productIds || [],
      tenantId: template.tenantId,
      expiryHours: template.expiryHours ?? undefined,
      logoUrl: template.logoUrl || "",
      publicTitle: template.publicTitle || "",
      publicDescription: template.publicDescription || "",
      wompiTitle: template.wompiTitle || "",
      wompiDescription: template.wompiDescription || "",
      utmParams: template.utmParams || "",
      layout: template.layout || undefined
    };
    const created = await createCheckoutTemplateService(payload as any);
    if (!created.ok) throw new Error(created.error);
    redirectWith("checkout_template_duplicate", "ok");
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_duplicate", "fail", String(err?.message || "duplicate_failed"));
  }
}

export async function createCheckoutTemplateDefaults(formData: FormData) {
  try {
    await assertCsrfToken(formData);
    const tenantIdInput = String(formData.get("tenantId") || "").trim();
    const modeRaw = String(formData.get("mode") || "").trim().toUpperCase();
    const mode = modeRaw === "PLAN" || modeRaw === "SUBSCRIPTION" || modeRaw === "BOTH" ? modeRaw : "BOTH";
    const tenants = await listTenants();
    const selectedTenants = tenantIdInput ? tenants.filter((t: any) => String(t.id) === tenantIdInput) : tenants;
    if (!selectedTenants.length) return redirectWith("checkout_template_defaults", "fail", "tenant_required");

    const settingsRes = await getAdminSettings();
    const checkoutConfig = (settingsRes as any)?.checkoutConfig || {};
    const logoUrl = String(checkoutConfig?.logoUrl || "").trim();
    const utmParams = String(checkoutConfig?.defaultUtmParams || "").trim();
    const planTitle = String(checkoutConfig?.planTitle || "Paga tu plan").trim();
    const planDescription = String(checkoutConfig?.planDescription || "Selecciona el plan que deseas pagar.").trim();
    const subTitle = String(checkoutConfig?.subscriptionTitle || "Guarda tu método de pago").trim();
    const subDescription = String(
      checkoutConfig?.subscriptionDescription || "Guarda tu tarjeta para cobros automáticos."
    ).trim();

    let createdCount = 0;
    for (const tenant of selectedTenants) {
      const tenantId = String(tenant.id);
      const productsRes = await listCatalogProducts({ tenantId, take: 500 });
      const products = Array.isArray(productsRes?.items) ? productsRes.items : [];
      if (!products.length) continue;

      const templates = await listCheckoutTemplates({ tenantId });
      const hasCart = templates.some((t: any) => String(t?.kind || "") === "CART");

      if (!hasCart) {
        const first = products[0];
        if (!first) continue;
        await createCheckoutTemplateService({
          name: `Catálogo - ${String(first?.name || "Producto")}`,
          kind: "CART",
          active: true,
          allowProductSelect: true,
          productIds: [
            {
              id: first.id,
              mode: String(first?.metadata?.collectionMode || "AUTO_LINK").toUpperCase()
            }
          ],
          tenantId,
          logoUrl,
          publicTitle: planTitle,
          publicDescription: planDescription,
          wompiTitle: planTitle,
          wompiDescription: planDescription,
          utmParams
        } as any);
        createdCount += 1;
      }
    }

      if (!createdCount) return redirectWith("checkout_template_defaults", "fail", "nothing_to_create");
    redirectWith("checkout_template_defaults", "ok");
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_defaults", "fail", String(err?.message || "defaults_failed"));
  }
}
