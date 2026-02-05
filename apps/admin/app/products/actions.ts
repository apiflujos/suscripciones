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

function computeTotalInCents(args: {
  basePriceInCents: number;
  variantDeltaInCents: number;
  discountType?: string | null;
  discountValueInCents?: number | null;
  discountPercent?: number | null;
  taxPercent?: number | null;
}): { subtotalInCents: number; taxInCents: number; totalInCents: number } {
  const base = Number(args.basePriceInCents || 0);
  const delta = Number(args.variantDeltaInCents || 0);
  const taxPercent = Number(args.taxPercent || 0);
  const discountType = String(args.discountType || "NONE");
  const discountValue = Number(args.discountValueInCents || 0);
  const discountPercent = Number(args.discountPercent || 0);

  let subtotal = base + delta;
  if (discountType === "FIXED") subtotal -= discountValue;
  else if (discountType === "PERCENT") subtotal -= Math.round((subtotal * discountPercent) / 100);
  if (subtotal < 0) subtotal = 0;
  const tax = Math.round((subtotal * taxPercent) / 100);
  return { subtotalInCents: subtotal, taxInCents: tax, totalInCents: subtotal + tax };
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
    redirect(`/products?error=${encodeURIComponent(err?.message || "create_product_failed")}`);
  }
}

export async function createPlanOrSubscription(formData: FormData) {
  const billingType = String(formData.get("billingType") || "SUBSCRIPTION").trim();
  const customerId = String(formData.get("customerId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const intervalUnit = String(formData.get("intervalUnit") || "MONTH").trim();
  const intervalCountRaw = Number(String(formData.get("intervalCount") || "1"));
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;
  const startAt = String(formData.get("startAt") || "").trim();
  const firstPeriodEndAt = String(formData.get("firstPeriodEndAt") || "").trim();

  const catalogItemId = String(formData.get("catalogItemId") || "").trim();
  const option1Value = String(formData.get("option1Value") || "").trim();
  const option2Value = String(formData.get("option2Value") || "").trim();

  try {
    const products = await adminFetch("/admin/products", { method: "GET" });
    const item = (products?.items ?? []).find((p: any) => String(p.id) === catalogItemId);
    if (!item) throw new Error("producto_no_encontrado");

    const variants = Array.isArray(item.variants) ? item.variants : [];
    const matched = variants.find(
      (v: any) => String(v?.option1 || "") === String(option1Value || "") && String(v?.option2 || "") === String(option2Value || "")
    );
    const delta = matched?.priceDeltaInCents ? Number(matched.priceDeltaInCents) : 0;

    const totals = computeTotalInCents({
      basePriceInCents: Number(item.basePriceInCents || 0),
      variantDeltaInCents: delta,
      discountType: item.discountType,
      discountValueInCents: item.discountValueInCents,
      discountPercent: item.discountPercent,
      taxPercent: item.taxPercent
    });

    const collectionMode = billingType === "PLAN" ? "AUTO_LINK" : "AUTO_DEBIT";

    const createdPlan = await adminFetch("/admin/plans", {
      method: "POST",
      body: JSON.stringify({
        name,
        priceInCents: totals.totalInCents,
        currency: item.currency || "COP",
        intervalUnit,
        intervalCount,
        collectionMode,
        metadata: {
          catalog: {
            itemId: item.id,
            sku: item.sku,
            name: item.name,
            kind: item.kind,
            option1Name: item.option1Name || null,
            option2Name: item.option2Name || null,
            option1Value: option1Value || null,
            option2Value: option2Value || null,
            variantDeltaInCents: delta || 0
          },
          pricing: {
            basePriceInCents: Number(item.basePriceInCents || 0),
            subtotalInCents: totals.subtotalInCents,
            taxPercent: Number(item.taxPercent || 0),
            taxInCents: totals.taxInCents,
            discountType: item.discountType || "NONE",
            discountValueInCents: Number(item.discountValueInCents || 0),
            discountPercent: Number(item.discountPercent || 0),
            totalInCents: totals.totalInCents
          }
        }
      })
    });

    const planId = createdPlan?.plan?.id;
    if (!planId) throw new Error("plan_create_failed");

    const createdSub = await adminFetch("/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        planId,
        ...(startAt ? { startAt } : {}),
        ...(firstPeriodEndAt ? { firstPeriodEndAt } : {})
      })
    });

    const subId = createdSub?.subscription?.id;
    if (billingType === "PLAN" && subId && firstPeriodEndAt) {
      const end = new Date(firstPeriodEndAt);
      if (!Number.isNaN(end.getTime()) && end.getTime() <= Date.now() + 2 * 60_000) {
        const link = await adminFetch(`/admin/subscriptions/${subId}/payment-link`, { method: "POST", body: JSON.stringify({}) });
        if (link?.checkoutUrl) {
          redirect(`/billing?created=1&checkoutUrl=${encodeURIComponent(String(link.checkoutUrl))}`);
        }
      }
    }

    redirect("/billing?created=1");
  } catch (err: any) {
    redirect(`/products?error=${encodeURIComponent(err?.message || "create_billing_failed")}`);
  }
}
