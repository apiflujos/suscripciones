"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");

async function adminFetch(path: string, init: RequestInit) {
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
  if (!res.ok) throw new Error(json?.reason ? `${json?.error || "request_failed"}:${json.reason}` : json?.error || `request_failed_${res.status}`);
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
  const taxable = true;
  const requiresShipping = kind === "PRODUCT" ? String(formData.get("requiresShipping") || "") === "on" : false;
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
    redirect("/products?created=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/products?error=${encodeURIComponent(err?.message || "create_product_failed")}`);
  }
}
