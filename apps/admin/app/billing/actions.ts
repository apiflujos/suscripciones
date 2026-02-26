"use server";

import { redirect } from "next/navigation";
import crypto from "crypto";
import { getAdminApiConfig } from "../lib/adminApi";
import { assertCsrfToken } from "../lib/csrf";

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
  const { apiBase, token } = getAdminApiConfig();
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {}),
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
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
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
      body: JSON.stringify({ name, email: email || undefined, phone: phone || undefined, metadata, tenantId })
    });
    const id = json?.customer?.id ? String(json.customer.id) : "";
    redirect(mergeQuery(returnTo, { contactCreated: "1", ...(id ? { selectCustomerId: id } : {}), ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_customer_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function createPlanTemplate(formData: FormData) {
  await assertCsrfToken(formData);
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

export async function updatePlanRecurrence(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const planId = String(formData.get("planId") || "").trim();
  const intervalUnit = String(formData.get("intervalUnit") || "MONTH").trim();
  const intervalCountRaw = Number(String(formData.get("intervalCount") || "1"));
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";

  if (!planId) return redirect(mergeQuery(returnTo, { error: "missing_plan_id", ...(tenantId ? { tenantId } : {}) }));

  try {
    await adminFetch(`/admin/plans/${encodeURIComponent(planId)}`, {
      method: "PUT",
      body: JSON.stringify({ intervalUnit, intervalCount })
    });
    redirect(mergeQuery(returnTo, { planUpdated: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "update_plan_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function chargeSubscriptionNow(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!subscriptionId) return redirect(mergeQuery(returnTo, { error: "missing_subscription_id" }));

  try {
    const path = tenantId
      ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/charge-now?tenantId=${encodeURIComponent(tenantId)}`
      : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/charge-now`;
    await adminFetch(path, { method: "POST", body: JSON.stringify({}) });
    redirect(mergeQuery(returnTo, { charged: "1", subscriptionId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "charge_now_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function scheduleCutoff(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const cutoffAt = String(formData.get("cutoffAt") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!subscriptionId || !cutoffAt) return redirect(mergeQuery(returnTo, { error: "missing_cutoff_date", ...(tenantId ? { tenantId } : {}) }));

  try {
    const path = tenantId
      ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/schedule-cutoff?tenantId=${encodeURIComponent(tenantId)}`
      : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/schedule-cutoff`;
    await adminFetch(path, { method: "POST", body: JSON.stringify({ cutoffAt }) });
    redirect(mergeQuery(returnTo, { cutoffScheduled: "1", subscriptionId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "schedule_cutoff_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function createPlanAndSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const productId = String(formData.get("productId") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  const billingTypeRaw = String(formData.get("billingType") || "SUBSCRIPCION").trim().toUpperCase();
  const billingType = billingTypeRaw === "PLAN" ? "PLAN" : "SUBSCRIPCION";
  const intervalUnit = String(formData.get("intervalUnit") || "MONTH").trim();
  const intervalCountRaw = Number(String(formData.get("intervalCount") || "1"));
  const intervalCount = Number.isFinite(intervalCountRaw) && intervalCountRaw > 0 ? Math.trunc(intervalCountRaw) : 1;
  const option1Value = String(formData.get("option1Value") || "").trim();
  const option2Value = String(formData.get("option2Value") || "").trim();
  const startAt = String(formData.get("startAt") || "").trim();
  const firstPeriodEndAt = String(formData.get("firstPeriodEndAt") || "").trim();
  const templateIdRaw = String(formData.get("templateId") || "").trim();
  const submitActionRaw = String(formData.get("submitAction") || "").trim().toUpperCase();
  const submitAction = submitActionRaw === "CHARGE_NOW" ? "CHARGE_NOW" : submitActionRaw === "LINK_NOW" ? "LINK_NOW" : "CREATE";

  if (!customerId || !productId) {
    return redirect(mergeQuery(returnTo, { error: "missing_customer_or_product" }));
  }

  try {
    const customerRes = await adminFetch(`/admin/customers/${customerId}`, { method: "GET" }).catch(() => null);
    const customer = customerRes?.customer || {};
    const meta = customer?.metadata || {};
    const paymentSource =
      meta?.wompi?.paymentSourceId ||
      meta?.wompi?.payment_source_id ||
      meta?.paymentSourceId ||
      meta?.payment_source_id;
    const hasToken = Boolean(paymentSource);

    const settings = await adminFetch("/admin/settings", { method: "GET" }).catch(() => null);
    const checkoutConfig = settings?.checkoutConfig || {};
    const planBase = String(checkoutConfig?.planBaseUrl || "").trim();
    const subBase = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
    if (billingType === "PLAN" && !planBase) {
      return redirect(
        mergeQuery(returnTo, {
          error: "missing_plan_base_url",
          customerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }
    if (billingType === "SUBSCRIPCION" && !hasToken && !subBase) {
      return redirect(
        mergeQuery(returnTo, {
          error: "missing_subscription_base_url",
          customerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }

    const product = await adminFetch(
      tenantId ? `/admin/products/${encodeURIComponent(productId)}?tenantId=${encodeURIComponent(tenantId)}` : `/admin/products/${encodeURIComponent(productId)}`,
      { method: "GET" }
    );
    const item = product?.item ?? null;
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

    if (!totals.totalInCents || totals.totalInCents <= 0) throw new Error("monto_invalido");

    const collectionMode = billingType === "PLAN" ? "AUTO_LINK" : "AUTO_DEBIT";

    const templateCandidate = templateIdRaw
      ? await adminFetch(
          tenantId
            ? `/admin/checkout-templates/${encodeURIComponent(templateIdRaw)}?tenantId=${encodeURIComponent(tenantId)}`
            : `/admin/checkout-templates/${encodeURIComponent(templateIdRaw)}`,
          { method: "GET" }
        ).then((r) => r?.item ?? null).catch(() => null)
      : null;
    const template =
      templateCandidate &&
      String(templateCandidate.kind || "").toUpperCase() === (billingType === "PLAN" ? "PLAN" : "SUBSCRIPTION")
        ? templateCandidate
        : null;

    const createdPlan = await adminFetch("/admin/plans", {
      method: "POST",
      body: JSON.stringify({
        ...(tenantIds.length ? { tenantIds } : {}),
        name: `${billingType === "PLAN" ? "Plan" : "Suscripción"} - ${item.name}`,
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
    if (!planId) throw new Error("create_plan_failed");

    const shouldCreateLink = billingType === "PLAN";
    let startAtValue = startAt || "";
    let endAtValue = firstPeriodEndAt || "";
    if (submitAction === "CHARGE_NOW") {
      const now = new Date().toISOString();
      startAtValue = startAtValue || now;
      endAtValue = startAtValue;
    }

    const sub = await adminFetch("/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        planId,
        ...(tenantIds.length ? { tenantIds } : {}),
        ...(template?.id ? { metadata: { templateId: String(template.id) } } : {}),
        ...(startAtValue ? { startAt: startAtValue } : {}),
        ...(endAtValue ? { firstPeriodEndAt: endAtValue } : {}),
        ...(shouldCreateLink ? { createPaymentLink: true } : {})
      })
    });

    const checkoutUrl = sub?.checkoutUrl ? String(sub.checkoutUrl) : "";
    const templateExpiryHours = template?.expiryHours ?? null;
    const configExpiryHours =
      Number.isFinite(Number(checkoutConfig?.tokenExpiryHours)) && Number(checkoutConfig?.tokenExpiryHours) > 0
        ? Math.min(Math.max(Math.trunc(Number(checkoutConfig?.tokenExpiryHours)), 1), 168)
        : null;
    const expiryHours = template
      ? (Number.isFinite(Number(templateExpiryHours)) && Number(templateExpiryHours) > 0
          ? Math.min(Math.max(Math.trunc(Number(templateExpiryHours)), 1), 168)
          : null)
      : configExpiryHours;

    if (billingType === "PLAN" && checkoutUrl) {
      const base = planBase;
      const token = crypto.randomBytes(18).toString("hex");
      const baseUrl = `${base.replace(/\/$/, "")}/public/plan/${token}`;
    const utm = String(template?.utmParams || checkoutConfig?.defaultUtmParams || "").trim();
      const url = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;
      const expiresAt = expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : null;
      const prevMeta = customer?.metadata ?? {};
      const nextMeta = {
        ...prevMeta,
        paymentLink: {
          url,
          token,
          checkoutUrl,
          planId,
          kind: "PLAN",
          templateId: template?.id || null,
          utmParams: template?.utmParams || null,
          createdAt: new Date().toISOString(),
          expiresAt,
          usedAt: null
        }
      };
      await adminFetch(`/admin/customers/${customerId}`, {
        method: "PUT",
        body: JSON.stringify({ metadata: nextMeta })
      }).catch(() => {});

      const content = `Hola ${customer?.name || "Cliente"}, aquí está tu link de pago: ${url}`;
      await adminFetch("/admin/chatwoot/messages", {
        method: "POST",
        body: JSON.stringify({ customerId, content })
      }).catch(() => {});

      redirect(
        mergeQuery(returnTo, {
          created: "1",
          checkoutUrl: url,
          customerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }

    if (billingType === "SUBSCRIPCION") {
      if (hasToken) {
        redirect(mergeQuery(returnTo, { created: "1", customerId, ...(tenantId ? { tenantId } : {}) }));
      }
      const base = subBase;
      const token = crypto.randomBytes(18).toString("hex");
      const baseUrl = `${base.replace(/\/$/, "")}/public/suscripcion/${token}`;
      const utm = String(template?.utmParams || checkoutConfig?.defaultUtmParams || "").trim();
      const url = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;
      const expiresAt = expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : null;
      const prevMeta = customer?.metadata ?? {};
      const nextMeta = {
        ...prevMeta,
        tokenizationLink: {
          url,
          token,
          planId,
          kind: "SUBSCRIPTION",
          templateId: template?.id || null,
          utmParams: template?.utmParams || null,
          createdAt: new Date().toISOString(),
          expiresAt,
          usedAt: null
        }
      };
      await adminFetch(`/admin/customers/${customerId}`, {
        method: "PUT",
        body: JSON.stringify({ metadata: nextMeta })
      }).catch(() => {});

      const content = `Hola ${customer?.name || "Cliente"}, activa tu suscripción guardando tu método de pago aquí: ${url}`;
      await adminFetch("/admin/chatwoot/messages", {
        method: "POST",
        body: JSON.stringify({ customerId, content })
      }).catch(() => {});

      redirect(mergeQuery(returnTo, { created: "1", checkoutUrl: url, customerId, ...(tenantId ? { tenantId } : {}) }));
    }

    if (checkoutUrl) {
      redirect(
        mergeQuery(returnTo, {
          created: "1",
          checkoutUrl,
          customerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }
    redirect(mergeQuery(returnTo, { created: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_plan_and_subscription_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function sendChatwootPaymentLink(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const checkoutUrl = String(formData.get("checkoutUrl") || "").trim();
  const customerId = String(formData.get("customerId") || "").trim();
  if (!checkoutUrl || !customerId) return redirect(mergeQuery(returnTo, { error: "missing_checkout_or_customer" }));

  const content = `Link de pago: ${checkoutUrl}`;

  try {
    await adminFetch("/admin/chatwoot/messages", {
      method: "POST",
      body: JSON.stringify({ customerId, content })
    });
    redirect(mergeQuery(returnTo, { created: "1", central: "sent", customerId, checkoutUrl }));
  } catch (err: any) {
    redirect(mergeQuery(returnTo, { error: String(err?.message || "chatwoot_send_failed") }));
  }
}

export async function sendCentralComPaymentLink(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const customerId = String(formData.get("customerId") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!subscriptionId || !customerId) {
    return redirect(mergeQuery(returnTo, { error: "missing_subscription_or_customer", ...(tenantId ? { tenantId } : {}) }));
  }

  try {
    const path = tenantId
      ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/payment-link?tenantId=${encodeURIComponent(tenantId)}`
      : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/payment-link`;
    const json = await adminFetch(path, { method: "POST", body: JSON.stringify({}) });
    const checkoutUrl = String(json?.checkoutUrl || "").trim();
    if (!checkoutUrl) return redirect(mergeQuery(returnTo, { error: "checkout_url_missing", ...(tenantId ? { tenantId } : {}) }));

    const content = `Link de pago: ${checkoutUrl}`;
    await adminFetch("/admin/chatwoot/messages", {
      method: "POST",
      body: JSON.stringify({ customerId, content })
    });

    redirect(
      mergeQuery(returnTo, {
        central: "sent",
        checkoutUrl,
        customerId,
        ...(tenantId ? { tenantId } : {})
      })
    );
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "centralcom_send_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function sendCentralComTokenizationLink(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!customerId) return redirect(mergeQuery(returnTo, { error: "missing_customer_id", ...(tenantId ? { tenantId } : {}) }));

  try {
    const [settings, customerRes] = await Promise.all([
      adminFetch("/admin/settings", { method: "GET" }).catch(() => null),
      adminFetch(`/admin/customers/${encodeURIComponent(customerId)}`, { method: "GET" }).catch(() => null)
    ]);
    const checkoutConfig = settings?.checkoutConfig || {};
    const base = String(checkoutConfig?.subscriptionBaseUrl || "").trim();
    if (!base) {
      return redirect(mergeQuery(returnTo, { error: "missing_subscription_base_url", ...(tenantId ? { tenantId } : {}) }));
    }

    const token = crypto.randomBytes(18).toString("hex");
    const baseUrl = `${base.replace(/\/$/, "")}/public/suscripcion/${token}`;
    const utm = String(checkoutConfig?.defaultUtmParams || "").trim();
    const url = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;
    const expiryHours =
      Number.isFinite(Number(checkoutConfig?.tokenExpiryHours)) && Number(checkoutConfig?.tokenExpiryHours) > 0
        ? Math.min(Math.max(Math.trunc(Number(checkoutConfig?.tokenExpiryHours)), 1), 168)
        : null;
    const expiresAt = expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : null;

    const customer = customerRes?.customer || {};
    const prevMeta = customer?.metadata ?? {};
    const nextMeta = {
      ...prevMeta,
      tokenizationLink: {
        url,
        token,
        planId: planId || prevMeta?.tokenizationLink?.planId || null,
        kind: "SUBSCRIPTION",
        createdAt: new Date().toISOString(),
        expiresAt,
        usedAt: null
      }
    };
    await adminFetch(`/admin/customers/${encodeURIComponent(customerId)}`, {
      method: "PUT",
      body: JSON.stringify({ metadata: nextMeta })
    }).catch(() => {});

    const content = `Hola ${customer?.name || "Cliente"}, activa tu suscripción guardando tu método de pago aquí: ${url}`;
    await adminFetch("/admin/chatwoot/messages", {
      method: "POST",
      body: JSON.stringify({ customerId, content })
    });

    redirect(mergeQuery(returnTo, { central: "sent", tokenUrl: url, customerId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "centralcom_send_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function deletePlanAndSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!subscriptionId || !planId) return redirect("/billing?error=missing_plan_or_subscription");

  try {
    const path = tenantId
      ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}?tenantId=${encodeURIComponent(tenantId)}&force=1`
      : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}?force=1`;
    await adminFetch(path, {
      method: "DELETE"
    });
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_subscription_failed");
    if (msg.includes("subscription_must_be_canceled")) {
      return redirect(`/billing?error=${encodeURIComponent("Primero cancela la suscripción para poder eliminarla.")}`);
    }
    if (msg.includes("subscription_has_dependencies")) {
      return redirect(`/billing?error=${encodeURIComponent("No se puede borrar: la suscripción tiene pagos o links asociados.")}`);
    }
    return redirect(`/billing?error=${encodeURIComponent(msg)}`);
  }

  try {
    const path = tenantId
      ? `/admin/plans/${encodeURIComponent(planId)}?tenantId=${encodeURIComponent(tenantId)}&force=1`
      : `/admin/plans/${encodeURIComponent(planId)}?force=1`;
    await adminFetch(path, { method: "DELETE" });
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_plan_failed");
    if (msg.includes("plan_has_dependencies")) {
      return redirect(`/billing?error=${encodeURIComponent("No se puede borrar el plan: tiene dependencias.")}`);
    }
    return redirect(`/billing?error=${encodeURIComponent(msg)}`);
  }

  const qs = new URLSearchParams({ deletedPlan: "1", ...(tenantId ? { tenantId } : {}) }).toString();
  redirect(`/billing?${qs}`);
}
