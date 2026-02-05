"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = process.env.API_ADMIN_TOKEN || "";

async function adminFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `request_failed_${res.status}`);
  return json;
}

function pesosToCents(input: string): number {
  const digits = String(input || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
}

export async function createProduct(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const sku = String(formData.get("sku") || "").trim();
  const kind = String(formData.get("kind") || "PRODUCT").trim();
  const currency = String(formData.get("currency") || "COP").trim();
  const basePriceInCents = pesosToCents(String(formData.get("basePricePesos") || ""));
  const taxPercent = Number(String(formData.get("taxPercent") || "0"));
  const discountType = String(formData.get("discountType") || "NONE").trim();
  const discountValueInCents = pesosToCents(String(formData.get("discountValuePesos") || ""));
  const discountPercent = Number(String(formData.get("discountPercent") || "0"));
  const description = String(formData.get("description") || "").trim();
  const vendor = String(formData.get("vendor") || "").trim();
  const productType = String(formData.get("productType") || "").trim();
  const tags = String(formData.get("tags") || "").trim();
  const unit = String(formData.get("unit") || "").trim();
  const taxable = String(formData.get("taxable") || "") === "on";
  const requiresShipping = String(formData.get("requiresShipping") || "") === "on";
  const option1Name = String(formData.get("option1Name") || "").trim();
  const option2Name = String(formData.get("option2Name") || "").trim();
  const variantsJson = String(formData.get("variantsJson") || "").trim();

  let variants: any[] | undefined;
  if (variantsJson) {
    try {
      const parsed = JSON.parse(variantsJson);
      if (Array.isArray(parsed)) variants = parsed;
    } catch {}
  }

  try {
    await adminFetch("/admin/products", {
      method: "POST",
      body: JSON.stringify({
        name,
        sku,
        kind,
        currency,
        basePriceInCents,
        taxPercent,
        discountType,
        discountValueInCents,
        discountPercent,
        description: description || null,
        vendor: vendor || null,
        productType: productType || null,
        tags: tags || null,
        unit: unit || null,
        taxable,
        requiresShipping,
        option1Name: option1Name || null,
        option2Name: option2Name || null,
        variants: variants || null
      })
    });
    redirect("/products?tab=inventory&created=1");
  } catch (err: any) {
    redirect(`/products?tab=inventory&error=${encodeURIComponent(err?.message || "create_product_failed")}`);
  }
}

export async function createOrder(formData: FormData) {
  const customerId = String(formData.get("customerId") || "").trim();
  const source = String(formData.get("source") || "MANUAL").trim();
  const reference = String(formData.get("reference") || "").trim();
  const currency = String(formData.get("currency") || "COP").trim();
  const expiresAtLocal = String(formData.get("expiresAt") || "").trim();
  const expiresAt = expiresAtLocal ? new Date(expiresAtLocal).toISOString() : "";
  const taxPercent = Number(String(formData.get("taxPercent") || "0"));
  const discountType = String(formData.get("discountType") || "NONE").trim();
  const discountValueInCents = pesosToCents(String(formData.get("discountValuePesos") || ""));
  const discountPercent = Number(String(formData.get("discountPercent") || "0"));
  const sendChatwoot = String(formData.get("sendChatwoot") || "") === "on";

  // Minimal: single line item from a "catalog item"
  const itemName = String(formData.get("itemName") || "").trim();
  const itemSku = String(formData.get("itemSku") || "").trim();
  const quantity = Number(String(formData.get("quantity") || "1"));
  const unitPriceInCents = pesosToCents(String(formData.get("unitPricePesos") || ""));

  try {
    const json = await adminFetch("/admin/orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        source,
        reference,
        currency,
        ...(expiresAt ? { expiresAt } : {}),
        taxPercent,
        discountType,
        discountValueInCents,
        discountPercent,
        sendChatwoot,
        lineItems: [
          {
            sku: itemSku || null,
            name: itemName,
            quantity: Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 1,
            unitPriceInCents
          }
        ]
      })
    });
    const checkoutUrl = String(json?.checkoutUrl || "");
    redirect(`/products?tab=orders&created=1${checkoutUrl ? `&checkoutUrl=${encodeURIComponent(checkoutUrl)}` : ""}`);
  } catch (err: any) {
    redirect(`/products?tab=orders&error=${encodeURIComponent(err?.message || "create_order_failed")}`);
  }
}
