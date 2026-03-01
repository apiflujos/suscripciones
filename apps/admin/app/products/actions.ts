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

function readTenantIds(formData: FormData): string[] {
  const raw = formData.getAll("tenantIds").map((v) => String(v || "").trim()).filter(Boolean);
  const single = String(formData.get("tenantId") || "").trim();
  const out = raw.length ? raw : (single ? [single] : []);
  return Array.from(new Set(out));
}

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  return raw.startsWith("/products") ? raw : "/products";
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

function formatCurrency(amountInCents: number, currency: string) {
  const code = currency || "COP";
  const amount = Math.trunc(Number(amountInCents || 0) / 100);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
}

function normalizeMessage(input: string) {
  const lines = String(input || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " "));
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(line.trimEnd());
  }
  return out.join("\n").trim();
}

function renderTemplate(template: string, data: Record<string, string>) {
  let out = String(template || "");
  for (const [key, value] of Object.entries(data)) {
    out = out.replaceAll(`{{${key}}}`, value || "");
  }
  return normalizeMessage(out);
}

function buildOrderReference(product: { sku?: string | null; id: string }) {
  const sku = String(product.sku || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const base = sku || String(product.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
  const stamp = Date.now();
  return `PROD_${base}_${stamp}`.slice(0, 50);
}

export async function createProduct(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const name = String(formData.get("name") || "").trim();
  const sku = String(formData.get("sku") || "").trim();
  const kind = String(formData.get("kind") || "PRODUCT").trim();
  const currency = String(formData.get("currency") || "COP").trim();
  const basePriceInCents = pesosToCents(String(formData.get("basePricePesos") || ""));
  const intervalUnit = String(formData.get("intervalUnit") || "MONTH").trim();
  const intervalCountRaw = Number(String(formData.get("intervalCount") || "1"));
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;
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
  const imageUrl = String(formData.get("imageUrl") || "").trim();
  const collectionMode = String(formData.get("collectionMode") || "AUTO_LINK").trim();
  const tenantIds = readTenantIds(formData);
  if (!name || !sku || basePriceInCents <= 0) {
    return redirect(mergeQuery(returnTo, { error: "invalid_body" }));
  }

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
        ...(tenantIds.length ? { tenantIds } : {}),
        name,
        sku,
        kind,
        currency,
        basePriceInCents,
        intervalUnit,
        intervalCount,
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
        variants: variants || null,
        imageUrl: imageUrl || null,
        metadata: {
          collectionMode
        }
      })
    });
    redirect(mergeQuery(returnTo, { created: "1" }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_product_failed") }));
  }
}

export async function updateProduct(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  const name = String(formData.get("name") || "").trim();
  const sku = String(formData.get("sku") || "").trim();
  const kind = String(formData.get("kind") || "PRODUCT").trim();
  const currency = String(formData.get("currency") || "COP").trim();
  const basePriceInCents = pesosToCents(String(formData.get("basePricePesos") || ""));
  const intervalUnit = String(formData.get("intervalUnit") || "MONTH").trim();
  const intervalCountRaw = Number(String(formData.get("intervalCount") || "1"));
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;
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
  const imageUrl = String(formData.get("imageUrl") || "").trim();
  const collectionMode = String(formData.get("collectionMode") || "AUTO_LINK").trim();

  let variants: any[] | undefined;
  if (variantsJson) {
    try {
      const parsed = JSON.parse(variantsJson);
      if (Array.isArray(parsed)) variants = parsed;
    } catch {}
  }

  if (!id) return redirect(mergeQuery(returnTo, { error: "missing_id" }));
  if (!name || !sku || basePriceInCents <= 0) {
    return redirect(mergeQuery(returnTo, { error: "invalid_body", ...(tenantId ? { tenantId } : {}) }));
  }

  try {
    await adminFetch(`/admin/products/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...(tenantIds.length ? { tenantIds } : tenantId ? { tenantId } : {}),
        name,
        sku,
        kind,
        currency,
        basePriceInCents,
        intervalUnit,
        intervalCount,
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
        variants: variants || null,
        imageUrl: imageUrl || null,
        metadata: {
          collectionMode
        }
      })
    });
    redirect(mergeQuery(returnTo, { updated: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "update_product_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function sendProductToCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const productId = String(formData.get("productId") || "").trim();
  const customerId = String(formData.get("customerId") || "").trim();
  const includePaymentLink = String(formData.get("includePaymentLink") || "") === "on";
  const includeImage = String(formData.get("includeImage") || "") === "on";
  const messageTemplate = String(formData.get("message") || "").trim();

  if (!productId || !customerId) {
    return redirect(mergeQuery(returnTo, { error: "missing_product_or_customer" }));
  }

  let product: any = null;
  let customer: any = null;
  try {
    const productRes = await adminFetch(`/admin/products/${encodeURIComponent(productId)}`, { method: "GET" });
    product = productRes?.item || null;
  } catch (err: any) {
    return redirect(mergeQuery(returnTo, { error: String(err?.message || "product_fetch_failed") }));
  }

  try {
    const customerRes = await adminFetch(`/admin/customers/${encodeURIComponent(customerId)}`, { method: "GET" });
    customer = customerRes?.customer || null;
  } catch (err: any) {
    return redirect(mergeQuery(returnTo, { error: String(err?.message || "customer_fetch_failed") }));
  }

  if (!product || !customer) {
    return redirect(mergeQuery(returnTo, { error: "product_or_customer_not_found" }));
  }

  const totals = computeTotalInCents({
    basePriceInCents: Number(product.basePriceInCents || 0),
    variantDeltaInCents: 0,
    discountType: product.discountType,
    discountValueInCents: Number(product.discountValueInCents || 0),
    discountPercent: Number(product.discountPercent || 0),
    taxPercent: Number(product.taxPercent || 0)
  });

  const customerName = String(customer?.name || customer?.email || customer?.phone || "Cliente").trim();

  let checkoutUrl = "";
  let templateParams: any = null;
  if (includePaymentLink) {
    try {
      const orderRes = await adminFetch("/admin/orders", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          reference: buildOrderReference(product),
          currency: String(product.currency || "COP"),
          discountType: product.discountType || "NONE",
          discountValueInCents: Number(product.discountValueInCents || 0),
          discountPercent: Number(product.discountPercent || 0),
          taxPercent: Number(product.taxPercent || 0),
          lineItems: [
            {
              sku: product.sku || undefined,
              name: product.name || "Producto",
              quantity: 1,
              unitPriceInCents: Number(product.basePriceInCents || 0)
            }
          ],
          sendChatwoot: false
        })
      });
      checkoutUrl = String(orderRes?.checkoutUrl || "");
    } catch (err: any) {
      return redirect(mergeQuery(returnTo, { error: String(err?.message || "order_create_failed") }));
    }

    try {
      const settingsRes = await adminFetch("/admin/settings", { method: "GET" });
      const comms = settingsRes?.communications || null;
      const activeEnv = String(comms?.activeEnv || "PRODUCTION").toUpperCase() === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
      const envCfg = activeEnv === "SANDBOX" ? comms?.sandbox : comms?.production;
      const templateName = String(envCfg?.productTemplateName || "").trim();
      const templateLang = String(envCfg?.productTemplateLang || "es").trim() || "es";
      if (templateName) {
        templateParams = {
          name: templateName,
          language: templateLang,
          category: "UTILITY",
          processed_params: {
            body: {
              "1": customerName,
              "2": String(product.name || "Producto"),
              "3": formatCurrency(totals.totalInCents, String(product.currency || "COP")),
              "4": checkoutUrl
            }
          }
        };
        if (includeImage && product.imageUrl) {
          templateParams.processed_params.header = {
            media_url: String(product.imageUrl || ""),
            media_type: "image"
          };
        }
      }
    } catch {}
  }

  const description = String(product.description || "").trim();
  const message = renderTemplate(messageTemplate, {
    cliente: customerName,
    producto: String(product.name || "Producto"),
    precio: formatCurrency(totals.totalInCents, String(product.currency || "COP")),
    descripcion: description,
    imagen: includeImage ? String(product.imageUrl || "") : "",
    link: includePaymentLink ? checkoutUrl : ""
  });

  if (!message) return redirect(mergeQuery(returnTo, { error: "empty_message" }));

  try {
    await adminFetch("/admin/chatwoot/messages", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        content: message,
        type: "PAYMENT_LINK",
        ...(templateParams ? { templateParams } : {})
      })
    });
  } catch (err: any) {
    return redirect(mergeQuery(returnTo, { error: String(err?.message || "chatwoot_send_failed") }));
  }

  redirect(mergeQuery(returnTo, { sent: "1" }));
}

export async function deleteProduct(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!id) return redirect(mergeQuery(returnTo, { error: "missing_id" }));

  try {
    const path = tenantId
      ? `/admin/products/${encodeURIComponent(id)}?tenantId=${encodeURIComponent(tenantId)}&force=1`
      : `/admin/products/${encodeURIComponent(id)}?force=1`;
    await adminFetch(path, {
      method: "DELETE"
    });
    redirect(mergeQuery(returnTo, { deleted: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_product_failed");
    if (msg.includes("product_has_dependencies")) {
      return redirect(mergeQuery(returnTo, { error: "No se puede borrar: tiene suscripciones o links asociados.", ...(tenantId ? { tenantId } : {}) }));
    }
    redirect(mergeQuery(returnTo, { error: msg, ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function createPlanTemplate(formData: FormData) {
  await assertCsrfToken(formData);
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
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
      const imageUrl = String(formData.get("itemImageUrl") || "").trim();

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
          ...(tenantIds.length ? { tenantIds } : {}),
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
          variants: variants || null,
          imageUrl: imageUrl || null,
          metadata: {
            collectionMode: billingType === "PLAN" ? "AUTO_LINK" : "AUTO_DEBIT"
          }
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
        variants: variants || null,
        imageUrl: imageUrl || null
      };
    } else {
      const products = await adminFetch(tenantId ? `/admin/products?tenantId=${encodeURIComponent(tenantId)}` : "/admin/products", { method: "GET" });
      item = (products?.items ?? []).find((p: any) => String(p.id) === catalogItemId);
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

    await adminFetch("/admin/plans", {
      method: "POST",
      body: JSON.stringify({
        ...(tenantIds.length ? { tenantIds } : {}),
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

    const qs = new URLSearchParams({ created: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/products?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "create_plan_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/products?${qs}`);
  }
}
