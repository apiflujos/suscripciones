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
import { getAdminSettings, getCheckoutConfig } from "../admin/_services/settings";
import { updateCheckoutConfig as updateCheckoutConfigService } from "../admin/_services/settingsActions";
import { listCatalogProducts } from "../admin/_services/products";
import { logger } from "@suscripciones/core/lib/logger";

const DEFAULT_RETURN_TO = "/settings?tab=checkout-publico";

/** Solo rutas internas de este módulo o de Ajustes (nunca `//otro-sitio`). */
function safeReturnTo(formData: FormData, field = "returnTo"): string {
  const raw = String(formData.get(field) || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "";
  if (raw === "/checkout-templates" || raw.startsWith("/checkout-templates/") || raw.startsWith("/checkout-templates?")) return raw;
  if (raw === "/settings" || raw.startsWith("/settings?")) return raw;
  return "";
}

/**
 * Redirige con el resultado. `returnTo` es la lista a la que se vuelve (por defecto
 * Ajustes, como antes); si falla y el formulario trae `errorTo` (la página del
 * formulario), se vuelve ahí para mostrar el error junto a los campos.
 */
function redirectWith(action: string, status: "ok" | "fail", error?: string, returnTo?: string, errorTo?: string) {
  const base = status === "fail" && errorTo ? errorTo : returnTo || DEFAULT_RETURN_TO;
  const url = new URL(base, "http://localhost");
  url.searchParams.set("a", action);
  url.searchParams.set("status", status);
  if (error) url.searchParams.set("error", error);
  else url.searchParams.delete("error");
  redirect(`${url.pathname}?${url.searchParams.toString()}`);
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
    } catch (err: any) {
      logger.warn({ err, raw: trimmed }, "JSON inválido en productIds de checkout template");
    }
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createCheckoutTemplate(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const errorTo = safeReturnTo(formData, "errorTo");
  try {
    await assertCsrfToken(formData);
    let layout: any = {};
    try {
      layout = JSON.parse(String(formData.get("layout") || "{}"));
    } catch (err: any) {
      logger.warn({ err }, "JSON inválido en layout al crear checkout template");
      layout = {};
    }
    const name = String(formData.get("name") || "").trim();
    const kind = String(formData.get("kind") || "PLAN").trim().toUpperCase();
    const tenantId = String(formData.get("tenantId") || "").trim();
    if (!name || (kind !== "PLAN" && kind !== "SUBSCRIPTION" && kind !== "CART")) {
      return redirectWith("checkout_template_create", "fail", "invalid_body", returnTo, errorTo);
    }
    if (!tenantId) {
      return redirectWith("checkout_template_create", "fail", "tenant_required", returnTo, errorTo);
    }

    const allowProductSelect = kind === "CART" ? String(formData.get("allowProductSelect") || "") === "on" : false;
    const productIds = parseProductIds(String(formData.get("productIds") || ""));
    if (!productIds.length) {
      return redirectWith("checkout_template_create", "fail", "product_required", returnTo, errorTo);
    }
    if (kind !== "CART" && productIds.length > 1) {
      return redirectWith("checkout_template_create", "fail", "max_one_product", returnTo, errorTo);
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
    redirectWith("checkout_template_create", "ok", undefined, returnTo, errorTo);
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_create", "fail", String(err?.message || "create_failed"), returnTo, errorTo);
  }
}

export async function updateCheckoutTemplate(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const errorTo = safeReturnTo(formData, "errorTo");
  try {
    await assertCsrfToken(formData);
    const id = String(formData.get("id") || "").trim();
    if (!id) return redirectWith("checkout_template_update", "fail", "missing_id", returnTo, errorTo);
    let layout: any = {};
    try {
      layout = JSON.parse(String(formData.get("layout") || "{}"));
    } catch (err: any) {
      logger.warn({ err, id }, "JSON inválido en layout al actualizar checkout template");
      layout = {};
    }
    const name = String(formData.get("name") || "").trim();
    const kind = String(formData.get("kind") || "PLAN").trim().toUpperCase();
    const tenantId = String(formData.get("tenantId") || "").trim();
    if (!name || (kind !== "PLAN" && kind !== "SUBSCRIPTION" && kind !== "CART")) {
      return redirectWith("checkout_template_update", "fail", "invalid_body", returnTo, errorTo);
    }
    const allowProductSelect = kind === "CART" ? String(formData.get("allowProductSelect") || "") === "on" : false;
    const productIds = parseProductIds(String(formData.get("productIds") || ""));
    if (!productIds.length) {
      return redirectWith("checkout_template_update", "fail", "product_required", returnTo, errorTo);
    }
    if (kind !== "CART" && productIds.length > 1) {
      return redirectWith("checkout_template_update", "fail", "max_one_product", returnTo, errorTo);
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
    redirectWith("checkout_template_update", "ok", undefined, returnTo, errorTo);
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_update", "fail", String(err?.message || "update_failed"), returnTo, errorTo);
  }
}

export async function deleteCheckoutTemplate(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const errorTo = safeReturnTo(formData, "errorTo");
  try {
    await assertCsrfToken(formData);
    const id = String(formData.get("id") || "").trim();
    if (!id) return redirectWith("checkout_template_delete", "fail", "missing_id", returnTo, errorTo);
    const res = await deleteCheckoutTemplateService({ id });
    if (!res.ok) throw new Error(res.error);
    redirectWith("checkout_template_delete", "ok", undefined, returnTo, errorTo);
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_delete", "fail", String(err?.message || "delete_failed"), returnTo, errorTo);
  }
}

export async function duplicateCheckoutTemplate(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const errorTo = safeReturnTo(formData, "errorTo");
  try {
    await assertCsrfToken(formData);
    const id = String(formData.get("id") || "").trim();
    if (!id) return redirectWith("checkout_template_duplicate", "fail", "missing_id", returnTo, errorTo);
    const existing = await getCheckoutTemplateById({ id });
    const template = existing.ok ? existing.item : null;
    if (!template) return redirectWith("checkout_template_duplicate", "fail", "not_found", returnTo, errorTo);
    if (!template.tenantId) return redirectWith("checkout_template_duplicate", "fail", "tenant_required", returnTo, errorTo);

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
    redirectWith("checkout_template_duplicate", "ok", undefined, returnTo, errorTo);
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_duplicate", "fail", String(err?.message || "duplicate_failed"), returnTo, errorTo);
  }
}

export async function createCheckoutTemplateDefaults(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const errorTo = safeReturnTo(formData, "errorTo");
  try {
    await assertCsrfToken(formData);
    const tenantIdInput = String(formData.get("tenantId") || "").trim();
    const modeRaw = String(formData.get("mode") || "").trim().toUpperCase();
    const mode = modeRaw === "PLAN" || modeRaw === "SUBSCRIPTION" || modeRaw === "BOTH" ? modeRaw : "BOTH";
    const tenants = await listTenants();
    const selectedTenants = tenantIdInput ? tenants.filter((t: any) => String(t.id) === tenantIdInput) : tenants;
    if (!selectedTenants.length) return redirectWith("checkout_template_defaults", "fail", "tenant_required", returnTo, errorTo);

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

      if (!createdCount) return redirectWith("checkout_template_defaults", "fail", "nothing_to_create", returnTo, errorTo);
    redirectWith("checkout_template_defaults", "ok", undefined, returnTo, errorTo);
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_template_defaults", "fail", String(err?.message || "defaults_failed"), returnTo, errorTo);
  }
}

/**
 * Guarda las plantillas predeterminadas desde /checkout-templates. Hace lo mismo que
 * `updateCheckoutDefaults` de Ajustes, pero vuelve a la página de origen (la de Ajustes
 * solo acepta rutas /settings).
 */
export async function saveCheckoutTemplateDefaults(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  try {
    await assertCsrfToken(formData);
    const current = await getCheckoutConfig();
    const merged = {
      ...current,
      defaultPlanTemplateId: String(formData.get("defaultPlanTemplateId") || "").trim(),
      defaultSubscriptionTemplateId: String(formData.get("defaultSubscriptionTemplateId") || "").trim(),
      defaultCartTemplateId: String(formData.get("defaultCartTemplateId") || "").trim()
    };
    const out: any = await updateCheckoutConfigService(merged as any);
    if (!out?.ok) throw new Error(out?.error || out?.message || `request_failed_${out?.status || 400}`);
    redirectWith("checkout_defaults", "ok", undefined, returnTo);
  } catch (err: any) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_defaults", "fail", String(err?.message || "defaults_failed"), returnTo);
  }
}
