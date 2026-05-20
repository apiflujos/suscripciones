"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { DEFAULT_CURRENCY, normalizeSupportedCurrency } from "../lib/currencies";
import {
  createCatalogProduct,
  deleteCatalogProduct,
  getCatalogProductById,
  listCatalogProducts,
  updateCatalogProduct
} from "../admin/_services/products";
import { getCustomerById } from "../admin/_services/customers";
import { getCheckoutConfig } from "../admin/_services/settings";
import { findCheckoutTemplateForProductOrDefault } from "../admin/_services/checkoutTemplates";
import { createManualOrderForAdmin } from "../admin/_services/orders";
import { createPlan } from "../admin/_services/plans";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { schedulePaymentLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { createPublicCheckoutLink } from "@suscripciones/core/services/publicCheckoutLinks";
import { logger } from "@suscripciones/core/lib/logger";
import { isNotificationTemplateConfigured, resolveNotificationTemplateForTrigger } from "../lib/notificationTemplate";

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

function buildOrderReference(product: { sku?: string | null; id: string }) {
  const sku = String(product.sku || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const base = sku || String(product.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
  const stamp = Date.now();
  return `PROD_${base}_${stamp}`.slice(0, 50);
}

function resolveNotificationTemplate(
  config: any,
  trigger: Parameters<typeof resolveNotificationTemplateForTrigger>[0]["trigger"],
  paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK"
) {
  return resolveNotificationTemplateForTrigger({
    rules: Array.isArray(config?.rules) ? config.rules : [],
    templates: Array.isArray(config?.templates) ? config.templates : [],
    trigger,
    paymentType
  });
}

export async function createProduct(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const name = String(formData.get("name") || "").trim();
  const sku = String(formData.get("sku") || "").trim();
  const kind = String(formData.get("kind") || "PRODUCT").trim();
  const currency = normalizeSupportedCurrency(String(formData.get("currency") || DEFAULT_CURRENCY));
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
  const imageUrl = String(formData.get("imageUrl") || "").trim();
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
    const created = await createCatalogProduct({
      tenantIds,
      name,
      sku,
      kind: kind === "SERVICE" ? "SERVICE" : "PRODUCT",
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
      metadata: {
        imageUrl: imageUrl || null,
        option1Name: option1Name || null,
        option2Name: option2Name || null,
        variants: variants || null
      }
    });
    if (!created.ok) throw new Error(created.error);
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
  const primaryTenantId = String(formData.get("primaryTenantId") || "").trim();
  const tenantId = tenantIds[0] || "";
  const name = String(formData.get("name") || "").trim();
  const sku = String(formData.get("sku") || "").trim();
  const kind = String(formData.get("kind") || "PRODUCT").trim();
  const currency = normalizeSupportedCurrency(String(formData.get("currency") || DEFAULT_CURRENCY));
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
  const imageUrl = String(formData.get("imageUrl") || "").trim();

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
    const updated = await updateCatalogProduct({
      productId: id,
      tenantId: tenantId || null,
      tenantIds,
      primaryTenantId: primaryTenantId || null,
      name,
      sku,
      kind: kind === "SERVICE" ? "SERVICE" : "PRODUCT",
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
      variants: variants || null,
      imageUrl: imageUrl || null
    });
    if (!updated.ok) throw new Error(updated.error);
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

  if (!productId || !customerId) {
    return redirect(mergeQuery(returnTo, { error: "missing_product_or_customer" }));
  }

  const notificationsConfig = await getNotificationsConfigForEnv("PRODUCTION").catch(() => null);
  const paymentTemplate = resolveNotificationTemplate(notificationsConfig, "PAYMENT_LINK_CREATED", "LINK");
  if (!isNotificationTemplateConfigured(paymentTemplate)) {
    return redirect(mergeQuery(returnTo, { error: "missing_template" }));
  }

  let product: any = null;
  let customer: any = null;
  try {
    const productRes = await getCatalogProductById({ productId });
    product = productRes.ok ? productRes.item : null;
  } catch (err: any) {
    return redirect(mergeQuery(returnTo, { error: String(err?.message || "product_fetch_failed") }));
  }

  try {
    customer = await getCustomerById(customerId);
  } catch (err: any) {
    return redirect(mergeQuery(returnTo, { error: String(err?.message || "customer_fetch_failed") }));
  }

  if (!product || !customer) {
    return redirect(mergeQuery(returnTo, { error: "product_or_customer_not_found" }));
  }

  try {
    const checkoutConfig = await getCheckoutConfig().catch(() => null);
    if (!checkoutConfig || !String(checkoutConfig?.planBaseUrl || "").trim()) {
      return redirect(mergeQuery(returnTo, { error: "missing_plan_base_url" }));
    }

    const tenantId = String(product?.tenantId || customer?.tenantId || "").trim() || null;
    const selected = await findCheckoutTemplateForProductOrDefault({
      tenantId,
      kind: "PLAN" as any,
      productId,
      defaultTemplateId: String(checkoutConfig?.defaultPlanTemplateId || "").trim()
    });
    const templateId = String((selected as any)?.id || "").trim();
    if (!templateId) {
      return redirect(mergeQuery(returnTo, { error: "missing_checkout_for_product" }));
    }

    const orderRes = await createManualOrderForAdmin({
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
      tenantId,
      sendChatwoot: false
    });
    if (!orderRes.ok) throw new Error(orderRes.error);

    const checkoutUrl = String((orderRes as any)?.checkoutUrl || "").trim();
    if (!checkoutUrl) {
      return redirect(mergeQuery(returnTo, { error: "checkout_url_missing" }));
    }

    const created = await createPublicCheckoutLink({
      customerId,
      templateId,
      checkoutUrl
    });
    if (!String(created?.url || "").trim()) {
      return redirect(mergeQuery(returnTo, { error: "public_checkout_create_failed" }));
    }

    const paymentId = String((orderRes as any)?.payment?.id || "").trim();
    if (!paymentId) {
      return redirect(mergeQuery(returnTo, { error: "request_failed" }));
    }

    const scheduled = await schedulePaymentLinkNotifications({
      paymentId,
      paymentLinkUrl: String(created?.url || "").trim() || undefined,
      forceNow: true
    }).catch((err: any) => {
      logger.error({ err, customerId, productId, paymentId }, "Fallo programando notificación de payment link desde productos");
      throw err;
    });
    const chatwootError = String((scheduled as any)?.errors?.[0] || "").trim();
    if (chatwootError) {
      return redirect(mergeQuery(returnTo, { error: chatwootError }));
    }
  } catch (err: any) {
    return redirect(mergeQuery(returnTo, { error: String(err?.message || "order_create_failed") }));
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
    const result = await deleteCatalogProduct({ productId: id, tenantId: tenantId || null, force: true });
    if (!result.ok) throw new Error(result.error);
    redirect(mergeQuery(returnTo, { deleted: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_product_failed");
    if (msg.includes("product_has_active_subscriptions")) {
      return redirect(
        mergeQuery(returnTo, {
          error: "No se puede borrar: primero cancela las suscripciones activas/en mora/suspendidas de este producto.",
          ...(tenantId ? { tenantId } : {})
        })
      );
    }
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
      const itemCurrency = normalizeSupportedCurrency(String(formData.get("itemCurrency") || DEFAULT_CURRENCY));
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
      } catch (err: any) {
        logger.warn({ err, variantsJson, tenantIds }, "JSON inválido en variantes al crear producto desde products");
      }

      if (!itemName || !itemSku) throw new Error("producto_incompleto");
      if (!basePriceInCents || basePriceInCents <= 0) throw new Error("precio_requerido");

      const created = await createCatalogProduct({
        tenantIds,
        name: itemName,
        sku: itemSku,
        kind: itemKind === "SERVICE" ? "SERVICE" : "PRODUCT",
        currency: itemCurrency,
        basePriceInCents,
        taxPercent,
        discountType,
        discountValueInCents,
        discountPercent,
        taxable: true,
        requiresShipping: itemKind === "PRODUCT",
        metadata: {
          option1Name: option1Name || null,
          option2Name: option2Name || null,
          variants: variants || null,
          imageUrl: imageUrl || null
        }
      });
      if (!created.ok) throw new Error(created.error);
      const createdItemId = (created as any)?.productId ? String((created as any).productId) : "";
      if (!createdItemId) throw new Error("crear_producto_failed");

      item = {
        id: createdItemId,
        sku: itemSku,
        name: itemName,
        kind: itemKind,
        currency: itemCurrency,
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
      const productsRes = await listCatalogProducts({ tenantId: tenantId || undefined });
      item = (productsRes?.items ?? []).find((p: any) => String(p.id) === catalogItemId);
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

    // Siempre crear como SUSCRIPCION (débito automático)
    const collectionMode = "AUTO_DEBIT";

    const createdPlan = await createPlan({
      tenantIds,
      name: name || `Suscripción - ${item.name}`,
      priceInCents: totals.totalInCents,
      currency: item.currency || "COP",
      intervalUnit: intervalUnit as any,
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
    });
    if (!createdPlan.ok) throw new Error(createdPlan.error);

    const qs = new URLSearchParams({ created: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/products?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "create_plan_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/products?${qs}`);
  }
}
