"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}

const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  return raw.startsWith("/billing") ? raw : "/billing";
}

function mergeQuery(path: string, extra: Record<string, string | undefined>) {
  const url = new URL(path, "http://localhost");
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    url.searchParams.set(k, v);
  }
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ""}`;
}

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

export async function createCustomerFromBilling(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const addressLine1 = String(formData.get("addressLine1") || "").trim();
  const dept = String(formData.get("dept") || "").trim();
  const city = String(formData.get("city") || "").trim();
  const code5 = String(formData.get("code5") || "").trim();
  const dane8 = String(formData.get("dane8") || "").trim();
  const idType = String(formData.get("idType") || "").trim();
  const idNumber = String(formData.get("idNumber") || "").trim();

  const address =
    addressLine1 || dept || city || code5 || dane8
      ? {
          line1: addressLine1 || undefined,
          dept: dept || undefined,
          city: city || undefined,
          code5: code5 || undefined,
          dane8: dane8 || undefined
        }
      : undefined;

  const identificacion = idType && idNumber ? `${idType} ${idNumber}` : idNumber || "";
  const idMeta = identificacion ? { identificacion, identificacionTipo: idType || null, identificacionNumero: idNumber || null } : undefined;

  const metadata = address || idMeta ? { ...(address ? { address } : {}), ...(idMeta ? idMeta : {}) } : undefined;

  try {
    const json = await adminFetch("/admin/customers", {
      method: "POST",
      body: JSON.stringify({ name, email: email || undefined, phone: phone || undefined, metadata })
    });
    const id = json?.customer?.id ? String(json.customer.id) : "";
    redirect(mergeQuery(returnTo, { contactCreated: "1", ...(id ? { selectCustomerId: id } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_customer_failed") }));
  }
}

export async function createPlanTemplate(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const billingTypeRaw = String(formData.get("billingType") || "SUBSCRIPCION").trim().toUpperCase();
  const billingType = billingTypeRaw === "PLAN" ? "PLAN" : "SUBSCRIPCION";
  const name = String(formData.get("name") || "").trim();
  const intervalUnit = String(formData.get("intervalUnit") || "MONTH").trim();
  const intervalCountRaw = Number(String(formData.get("intervalCount") || "1"));
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;

  const catalogMode = String(formData.get("catalogMode") || "EXISTING").trim();
  const catalogItemId = String(formData.get("catalogItemId") || "").trim();
  const option1Value = String(formData.get("option1Value") || "").trim();
  const option2Value = String(formData.get("option2Value") || "").trim();

  try {
    let item: any = null;

    if (catalogMode === "NEW") {
      const itemKind = String(formData.get("itemKind") || "PRODUCT").trim();
      const itemName = String(formData.get("itemName") || "").trim();
      const itemSku = String(formData.get("itemSku") || "").trim();
      const basePriceInCents = pesosToCents(String(formData.get("itemBasePricePesos") || ""));
      const taxPercent = Number(String(formData.get("itemTaxPercent") || "0"));
      const discountType = String(formData.get("itemDiscountType") || "NONE").trim();
      const discountValueInCents = pesosToCents(String(formData.get("itemDiscountValuePesos") || ""));
      const discountPercent = Number(String(formData.get("itemDiscountPercent") || "0"));
      const option1Name = String(formData.get("itemOption1Name") || "").trim();
      const option2Name = String(formData.get("itemOption2Name") || "").trim();
      const variantsJson = String(formData.get("itemVariantsJson") || "[]");

      let variants: any[] | null = null;
      try {
        const parsed = JSON.parse(variantsJson);
        if (Array.isArray(parsed)) variants = parsed;
      } catch {}

      if (!itemName || !itemSku) throw new Error("producto_incompleto");
      if (!basePriceInCents || basePriceInCents <= 0) throw new Error("precio_requerido");

      const created = await adminFetch("/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name: itemName,
          sku: itemSku,
          kind: itemKind,
          currency: "COP",
          basePriceInCents,
          taxPercent,
          discountType,
          discountValueInCents,
          discountPercent,
          taxable: true,
          requiresShipping: itemKind === "PRODUCT",
          option1Name: option1Name || null,
          option2Name: option2Name || null,
          variants: variants || null
        })
      });
      const createdItemId = created?.product?.id ? String(created.product.id) : "";
      if (!createdItemId) throw new Error("crear_producto_failed");

      item = {
        id: createdItemId,
        sku: itemSku,
        name: itemName,
        kind: itemKind,
        currency: "COP",
        basePriceInCents,
        taxPercent,
        discountType,
        discountValueInCents,
        discountPercent,
        option1Name: option1Name || null,
        option2Name: option2Name || null,
        variants: variants || null
      };
    } else {
      if (!catalogItemId) throw new Error("producto_no_encontrado");
      try {
        const product = await adminFetch(`/admin/products/${encodeURIComponent(catalogItemId)}`, { method: "GET" });
        item = product?.item ?? null;
      } catch {
        item = null;
      }
      if (!item) throw new Error("producto_no_encontrado");
    }

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

    if (!totals.totalInCents || totals.totalInCents <= 0) throw new Error("monto_invalido");

    const collectionMode = billingType === "PLAN" ? "AUTO_LINK" : "AUTO_DEBIT";

    const createdPlan = await adminFetch("/admin/plans", {
      method: "POST",
      body: JSON.stringify({
        name: name || `${billingType === "PLAN" ? "Plan" : "Suscripción"} - ${item.name}`,
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

    const planId = createdPlan?.plan?.id ? String(createdPlan.plan.id) : "";
    redirect(mergeQuery(returnTo, { planCreated: "1", ...(planId ? { selectPlanId: planId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_plan_failed") }));
  }
}
