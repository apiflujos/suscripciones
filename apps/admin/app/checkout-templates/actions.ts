"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { getRequiredApiBase } from "../lib/adminApi";
import { assertCsrfToken } from "../lib/csrf";

async function adminFetch(path: string, init: RequestInit) {
  const API_BASE = getRequiredApiBase();
  const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, "x-admin-token": TOKEN } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (json?.details) {
      throw new Error(`${json?.error || "request_failed"}:${JSON.stringify(json.details)}`);
    }
    throw new Error(json?.error || "request_failed");
  }
  return json;
}

function redirectWith(action: string, status: "ok" | "fail", error?: string) {
  const qp = new URLSearchParams({ a: action, status, tab: "checkout-publico" });
  if (error) qp.set("error", error);
  redirect(`/settings?${qp.toString()}`);
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
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
    const allowProductSelect = String(formData.get("allowProductSelect") || "") === "on";
    const productIds = String(formData.get("productIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tenantId = String(formData.get("tenantId") || "").trim();
    if (!name || (kind !== "PLAN" && kind !== "SUBSCRIPTION" && kind !== "CART")) {
      return redirectWith("checkout_template_create", "fail", "invalid_body");
    }
    if (!allowProductSelect && productIds.length === 0) {
      return redirectWith("checkout_template_create", "fail", "invalid_body");
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
    await adminFetch("/admin/checkout-templates", { method: "POST", body: JSON.stringify(payload) });
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
    const allowProductSelect = String(formData.get("allowProductSelect") || "") === "on";
    const productIds = String(formData.get("productIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tenantId = String(formData.get("tenantId") || "").trim();
    if (!name || (kind !== "PLAN" && kind !== "SUBSCRIPTION" && kind !== "CART")) {
      return redirectWith("checkout_template_update", "fail", "invalid_body");
    }
    if (!allowProductSelect && productIds.length === 0) {
      return redirectWith("checkout_template_update", "fail", "invalid_body");
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
    await adminFetch(`/admin/checkout-templates/${id}`, { method: "PUT", body: JSON.stringify(payload) });
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
    await adminFetch(`/admin/checkout-templates/${id}`, { method: "DELETE" });
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
    const existing = await adminFetch(`/admin/checkout-templates/${id}`, { method: "GET" });
    const template = existing?.item;
    if (!template) return redirectWith("checkout_template_duplicate", "fail", "not_found");

    const payload = {
      name: `Copia - ${template.name || "Plantilla"}`,
      kind: template.kind,
      active: template.active,
      allowProductSelect: template.allowProductSelect,
      productIds: template.productIds || [],
      tenantId: template.tenantId || undefined,
      expiryHours: template.expiryHours ?? undefined,
      logoUrl: template.logoUrl || "",
      publicTitle: template.publicTitle || "",
      publicDescription: template.publicDescription || "",
      wompiTitle: template.wompiTitle || "",
      wompiDescription: template.wompiDescription || "",
      utmParams: template.utmParams || "",
      layout: template.layout || undefined
    };
    await adminFetch("/admin/checkout-templates", { method: "POST", body: JSON.stringify(payload) });
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
    const tenantsRes = await adminFetch("/admin/tenants", { method: "GET" });
    const tenants = Array.isArray(tenantsRes?.items) ? tenantsRes.items : [];
    const selectedTenants = tenantIdInput ? tenants.filter((t: any) => String(t.id) === tenantIdInput) : tenants;
    if (!selectedTenants.length) return redirectWith("checkout_template_defaults", "fail", "tenant_required");

    const settingsRes = await adminFetch("/admin/settings", { method: "GET" });
    const checkoutConfig = settingsRes?.checkoutConfig || {};
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
      const productsRes = await adminFetch(`/admin/products?take=500&tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" });
      const products = Array.isArray(productsRes?.items) ? productsRes.items : [];
      const planProducts = products.filter((p: any) => {
        const mode = String(p?.collectionMode || p?.metadata?.collectionMode || "");
        return !mode || mode === "AUTO_LINK" || mode === "MANUAL_LINK";
      });
      const subProducts = products.filter((p: any) => String(p?.collectionMode || p?.metadata?.collectionMode || "") === "AUTO_DEBIT");
      if (!planProducts.length && !subProducts.length) continue;

      const templatesRes = await adminFetch(`/admin/checkout-templates?tenantId=${encodeURIComponent(tenantId)}`, { method: "GET" });
      const templates = Array.isArray(templatesRes?.items) ? templatesRes.items : [];
      const cartTemplates = templates.filter((t: any) => String(t?.kind || "") === "CART");

      const existingPlan = cartTemplates.find((t: any) => {
        const ids = Array.isArray(t?.productIds) ? t.productIds : [];
        let hasPlan = false;
        let hasSub = false;
        for (const id of ids) {
          const p = products.find((prod: any) => String(prod.id) === String(id));
          const mode = String(p?.collectionMode || p?.metadata?.collectionMode || "");
          if (!mode || mode === "AUTO_LINK" || mode === "MANUAL_LINK") hasPlan = true;
          if (mode === "AUTO_DEBIT") hasSub = true;
        }
        return hasPlan && !hasSub;
      });
      const existingSub = cartTemplates.find((t: any) => {
        const ids = Array.isArray(t?.productIds) ? t.productIds : [];
        let hasPlan = false;
        let hasSub = false;
        for (const id of ids) {
          const p = products.find((prod: any) => String(prod.id) === String(id));
          const mode = String(p?.collectionMode || p?.metadata?.collectionMode || "");
          if (!mode || mode === "AUTO_LINK" || mode === "MANUAL_LINK") hasPlan = true;
          if (mode === "AUTO_DEBIT") hasSub = true;
        }
        return hasSub && !hasPlan;
      });

      if (!existingPlan && planProducts.length) {
        await adminFetch("/admin/checkout-templates", {
          method: "POST",
          body: JSON.stringify({
            name: "Catálogo planes",
            kind: "CART",
            active: true,
            allowProductSelect: true,
            productIds: planProducts.map((p: any) => p.id),
            tenantId,
            logoUrl,
            publicTitle: planTitle,
            publicDescription: planDescription,
            wompiTitle: planTitle,
            wompiDescription: planDescription,
            utmParams
          })
        });
        createdCount += 1;
      }
      if (!existingSub && subProducts.length) {
        await adminFetch("/admin/checkout-templates", {
          method: "POST",
          body: JSON.stringify({
            name: "Catálogo suscripciones",
            kind: "CART",
            active: true,
            allowProductSelect: true,
            productIds: subProducts.map((p: any) => p.id),
            tenantId,
            logoUrl,
            publicTitle: subTitle,
            publicDescription: subDescription,
            wompiTitle: subTitle,
            wompiDescription: subDescription,
            utmParams
          })
        });
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
