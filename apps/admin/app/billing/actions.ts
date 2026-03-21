"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { DEFAULT_CURRENCY, normalizeSupportedCurrency } from "../lib/currencies";
import { createCustomer as createCustomerService, getCustomerById, updateCustomerProfile } from "../admin/_services/customers";
import { prisma } from "@suscripciones/database";
import { createCatalogProduct, getCatalogProductById } from "../admin/_services/products";
import { createPlan as createPlanService, updatePlanRecurrence as updatePlanRecurrenceService, deletePlan as deletePlanService } from "../admin/_services/plans";
import {
  createSubscription,
  createSubscriptionPaymentLink,
  chargeSubscriptionNow as chargeSubscriptionNowService,
  scheduleSubscriptionCutoff,
  recalcSubscriptionCutoff,
  updateSubscriptionTenants as updateSubscriptionTenantsService,
  changeSubscriptionPlan as changeSubscriptionPlanService,
  deleteSubscription as deleteSubscriptionService,
  markSubscriptionPaidManual as markSubscriptionPaidManualService,
  unmarkSubscriptionPaidManual as unmarkSubscriptionPaidManualService
} from "../admin/_services/subscriptions";
import { sendChatwootMessageForCustomer } from "../admin/_services/chatwoot";
import { getAdminSettings } from "../admin/_services/settings";
import { getCheckoutTemplateById } from "../admin/_services/checkoutTemplates";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { scheduleTokenizationLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { signPublicToken } from "../../lib/publicTokens";

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  if (raw.startsWith("/billing") || raw.startsWith("/customers") || raw.startsWith("/products")) return raw;
  return "/billing";
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

function normalizeCheckoutBase(raw: string, kind: "plan" | "suscripcion") {
  const base = String(raw || "").trim().replace(/\/+$/g, "");
  if (!base) return "";
  const suffix = kind === "plan" ? "/public/plan" : "/public/suscripcion";
  if (base.toLowerCase().endsWith(suffix)) return base.slice(0, -suffix.length);
  return base;
}

function pesosToCents(input: string): number {
  const digits = String(input || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
}

function humanizeCreateError(raw: string) {
  const msg = String(raw || "").trim();
  if (!msg) return "No se pudo crear la suscripción.";
  if (msg.includes("tenant_mismatch")) return "El contacto no pertenece al canal seleccionado.";
  if (msg.includes("tenant_not_allowed_for_plan")) return "El producto no está habilitado para ese canal.";
  if (msg.includes("missing_customer_or_product")) return "Falta seleccionar contacto o producto.";
  if (msg.includes("missing_shipping_amount")) return "Debes ingresar el valor del flete o activar envío gratis.";
  if (msg.includes("missing_subscription_base_url")) return "Falta configurar URL base de suscripción en Configuración.";
  if (msg.includes("missing_plan_base_url")) return "Falta configurar URL base de plan en Configuración.";
  if (msg.includes("duplicate_subscription_requires_approval")) return "Este cliente ya tiene una suscripción activa/en mora para el mismo producto. Debes confirmar creación duplicada.";
  if (msg.includes("create_plan_failed")) return "No se pudo crear el producto de cobro.";
  if (msg.includes("create_subscription_failed")) return "No se pudo crear la suscripción.";
  if (msg.includes("csrf_invalid")) return "La sesión expiró. Recarga la página e intenta de nuevo.";
  return msg;
}

function humanizeChargeError(raw: string) {
  const msg = String(raw || "").trim();
  if (!msg) return "No se pudo procesar el cobro.";
  if (msg.includes("customer_payment_source_missing")) return "El cliente no tiene una tarjeta tokenizada lista para débito automático.";
  if (msg.includes("customer_email_required")) return "El cliente no tiene correo electrónico y Wompi lo exige para cobrar.";
  if (msg.includes("charge_not_due_yet")) return "La suscripción todavía no está en fecha de cobro.";
  if (msg.includes("pending_charge_exists")) return "Ya existe un cobro pendiente reciente para esta suscripción.";
  if (msg.includes("manual_charge_disabled_by_settings")) return "El cobro manual está deshabilitado en la configuración.";
  if (msg.includes("manual_charge_not_allowed")) return "Esta suscripción no permite cobro manual.";
  if (msg.includes("payment_already_approved")) return "Esta suscripción ya fue cobrada para el ciclo actual.";
  if (msg.includes("subscription_not_found")) return "No se encontró la suscripción para el canal seleccionado.";
  if (msg.includes("invalid_body")) return "La solicitud de cobro es inválida.";
  if (msg.includes("fetch_failed")) return "No se pudo conectar con el API de suscripciones.";
  if (msg.includes("wompi_reference_already_used_guard")) return "Se bloqueó el cobro para evitar una transacción duplicada en Wompi.";
  if (msg.includes("wompi_private_key_not_configured")) return "Falta configurar la llave privada de Wompi.";
  if (msg.includes("wompi_public_key_not_configured")) return "Falta configurar la llave pública de Wompi.";
  if (msg.includes("wompi_integrity_secret_not_configured")) return "Falta configurar la firma de integridad de Wompi.";
  if (msg.includes("auto_debit_in_progress")) return "Ya hay un intento de débito automático en proceso.";
  if (msg.includes("csrf_invalid")) return "La sesión expiró. Recarga la página e intenta de nuevo.";
  return "No se pudo cobrar la suscripción.";
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildChatwootLinkMessage(args: { name?: string; lead: string; url: string }) {
  const safeName = escapeHtml(args.name || "Cliente");
  const safeLead = escapeHtml(args.lead);
  const safeUrl = escapeHtml(args.url);
  return `<p>Hola ${safeName},</p><p>${safeLead}</p><p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>`;
}

async function hasNotificationRule(trigger: string): Promise<boolean | null> {
  try {
    const cfg = await getNotificationsConfigForEnv("PRODUCTION");
    const rules = Array.isArray((cfg as any)?.rules) ? (cfg as any).rules : [];
    return rules.some((r: any) => r?.enabled && r?.trigger === trigger);
  } catch {
    return null;
  }
}

async function sendChatwootMessageSafe(args: { customerId: string; content: string }) {
  try {
    await sendChatwootMessageForCustomer({ customerId: args.customerId, content: args.content });
  } catch {
    // best effort
  }
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
  shippingInCents?: number | null;
  itemKind?: string | null;
  discountType?: string | null;
  discountValueInCents?: number | null;
  discountPercent?: number | null;
  taxPercent?: number | null;
}): { subtotalInCents: number; taxInCents: number; totalInCents: number } {
  const base = Number(args.basePriceInCents || 0);
  const delta = Number(args.variantDeltaInCents || 0);
  const shipping = String(args.itemKind || "").toUpperCase() === "PRODUCT" ? Number(args.shippingInCents || 0) : 0;
  const taxPercent = Number(args.taxPercent || 0);
  const discountType = String(args.discountType || "NONE");
  const discountValue = Number(args.discountValueInCents || 0);
  const discountPercent = Number(args.discountPercent || 0);

  let subtotal = base + delta + shipping;
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
    const res = await createCustomerService({
      data: {
        name: name || undefined,
        email: email || undefined,
        phone: phone || undefined,
        metadata
      } as any,
      tenantIds: tenantId ? [tenantId] : []
    });
    if (!res.ok) throw new Error(res.error);
    const id = res?.customer?.id ? String(res.customer.id) : "";
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
  const tenantIds = readTenantIds(formData);

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

      let variants: any[] | null = null;
      try {
        const parsed = JSON.parse(variantsJson);
        if (Array.isArray(parsed)) variants = parsed;
      } catch {}

      if (!itemName || !itemSku) throw new Error("producto_incompleto");
      if (!basePriceInCents || basePriceInCents <= 0) throw new Error("precio_requerido");

      const tenantId = tenantIds[0] || "";
      const created = await createCatalogProduct({
        tenantIds: tenantId ? [tenantId] : [],
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
          variants: variants || null
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
        variants: variants || null
      };
    } else {
      if (!catalogItemId) throw new Error("producto_no_encontrado");
      const tenantId = tenantIds[0] || "";
      const product = await getCatalogProductById({ productId: catalogItemId, tenantId: tenantId || null });
      item = product.ok ? product.item : null;
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
      itemKind: String(item.kind || ""),
      discountType: item.discountType,
      discountValueInCents: item.discountValueInCents,
      discountPercent: item.discountPercent,
      taxPercent: item.taxPercent
    });

    if (!totals.totalInCents || totals.totalInCents <= 0) throw new Error("monto_invalido");

    const collectionMode = billingType === "PLAN" ? "AUTO_LINK" : "AUTO_DEBIT";
    const tenantId = tenantIds[0] || "";

    const createdPlan = await createPlanService({
      tenantIds: tenantId ? [tenantId] : [],
      name: name || `${billingType === "PLAN" ? "Plan" : "Suscripción"} - ${item.name}`,
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

    const planId = (createdPlan as any)?.plan?.id ? String((createdPlan as any).plan.id) : "";
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
    const res = await updatePlanRecurrenceService({
      planId,
      intervalUnit: intervalUnit as any,
      intervalCount,
      tenantId: tenantId || null
    });
    if (!res.ok) throw new Error(res.error);
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
    const res = await chargeSubscriptionNowService({
      subscriptionId,
      tenantId: tenantId || null
    });
    if (!res.ok) throw new Error(res.error);
    const paymentId = (res as any)?.paymentId ? String((res as any).paymentId) : "";
    redirect(
      mergeQuery(returnTo, {
        chargeStatus: "processing",
        subscriptionId,
        ...(paymentId ? { paymentId } : {}),
        ...(tenantId ? { tenantId } : {})
      })
    );
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const detailRaw =
      err?.details && typeof err.details === "object"
        ? JSON.stringify(err.details)
        : err?.details
          ? String(err.details)
          : "";
    console.error("[billing.charge_now] Error al cobrar suscripción", {
      subscriptionId,
      tenantId: tenantId || null,
      error: String(err?.message || "charge_now_failed"),
      details: err?.details ?? null,
      paymentId: err?.paymentId ? String(err.paymentId) : null
    });
    redirect(
      mergeQuery(returnTo, {
        chargeStatus: "fail",
        chargeError: humanizeChargeError(String(err?.message || "charge_now_failed")),
        ...(detailRaw ? { chargeErrorDetails: detailRaw } : {}),
        ...(err?.paymentId ? { paymentId: String(err.paymentId) } : {}),
        subscriptionId,
        ...(tenantId ? { tenantId } : {})
      })
    );
  }
}

export async function markSubscriptionPaidManual(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  const manualMethod = String(formData.get("manualMethod") || "").trim().toUpperCase();
  if (!subscriptionId) return redirect(mergeQuery(returnTo, { error: "missing_subscription_id" }));

  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const actor = session?.email ? `admin:${session.email}` : "admin:unknown";

  try {
    const res = await markSubscriptionPaidManualService({
      subscriptionId,
      tenantId: tenantId || null,
      method: manualMethod as any,
      actor
    });
    if (!res.ok) throw new Error(res.error);
    redirect(
      mergeQuery(returnTo, {
        markPaidStatus: "ok",
        subscriptionId,
        ...(tenantId ? { tenantId } : {})
      })
    );
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(
      mergeQuery(returnTo, {
        markPaidStatus: "fail",
        markPaidError: String(err?.message || "manual_mark_failed"),
        subscriptionId,
        ...(tenantId ? { tenantId } : {})
      })
    );
  }
}

export async function unmarkSubscriptionPaidManual(formData: FormData) {
  assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim() || undefined;
  const returnTo = safeReturnTo(formData);
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const actor = session?.email ? `admin:${session.email}` : "admin:unknown";

  if (!subscriptionId) {
    redirect(mergeQuery(returnTo, { unmarkPaidStatus: "error", unmarkPaidError: "missing_subscription_id" }));
  }

  try {
    const res = await unmarkSubscriptionPaidManualService({
      subscriptionId,
      tenantId,
      actor
    });
    if (!res.ok) {
      redirect(mergeQuery(returnTo, { unmarkPaidStatus: "error", unmarkPaidError: res.error }));
    }
    redirect(mergeQuery(returnTo, { unmarkPaidStatus: "ok" }));
  } catch (err: any) {
    redirect(mergeQuery(returnTo, { unmarkPaidStatus: "error", unmarkPaidError: err?.message || "unknown_error" }));
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
    const res = await scheduleSubscriptionCutoff({ subscriptionId, cutoffAt, tenantId: tenantId || null });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { cutoffScheduled: "1", subscriptionId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "schedule_cutoff_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function recalcCutoff(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!subscriptionId) return redirect(mergeQuery(returnTo, { error: "missing_subscription_id", ...(tenantId ? { tenantId } : {}) }));

  try {
    const res = await recalcSubscriptionCutoff({ subscriptionId, tenantId: tenantId || null });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { cutoffRecalc: "1", subscriptionId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "recalc_cutoff_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function updateSubscriptionTenants(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const scopeTenantId = String(formData.get("scopeTenantId") || formData.get("tenantId") || "").trim();
  const tenantIds = formData
    .getAll("tenantIds")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const primaryTenantId = String(formData.get("primaryTenantId") || "").trim();
  if (!subscriptionId) {
    return redirect(mergeQuery(returnTo, { error: "missing_subscription_id", ...(scopeTenantId ? { tenantId: scopeTenantId } : {}) }));
  }
  try {
    const res = await updateSubscriptionTenantsService({
      subscriptionId,
      tenantId: scopeTenantId || null,
      tenantIds,
      primaryTenantId: primaryTenantId || null
    });
    if (!res.ok) throw new Error(res.error);
    redirect(
      mergeQuery(returnTo, {
        tenantsUpdated: "1",
        subscriptionId,
        ...(scopeTenantId ? { tenantId: scopeTenantId } : {})
      })
    );
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(
      mergeQuery(returnTo, {
        error: String(err?.message || "update_subscription_tenants_failed"),
        ...(scopeTenantId ? { tenantId: scopeTenantId } : {})
      })
    );
  }
}

export async function changeSubscriptionPlan(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  const cutoffAt = String(formData.get("cutoffAt") || "").trim();
  const shippingInCents = pesosToCents(String(formData.get("shippingPesos") || ""));
  const freeShipping = String(formData.get("freeShipping") || "").trim() === "1";
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!subscriptionId || !planId || !cutoffAt) {
    return redirect(mergeQuery(returnTo, { error: "missing_plan_or_cutoff", ...(tenantId ? { tenantId } : {}) }));
  }

  try {
    const res = await changeSubscriptionPlanService({
      subscriptionId,
      planId,
      cutoffAt,
      shippingInCents,
      freeShipping,
      tenantId: tenantId || null
    });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { planChanged: "1", subscriptionId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: humanizeCreateError(String(err?.message || "change_plan_failed")), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function createPlanAndSubscription(formData: FormData) {
  const returnTo = safeReturnTo(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const empresaId = String(formData.get("empresaId") || "").trim();
  const contactoId = String(formData.get("contactoId") || "").trim();
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
  const submitAction = submitActionRaw === "LINK_NOW" ? "LINK_NOW" : "CREATE";
  const allowDuplicate = String(formData.get("allowDuplicate") || "").trim() === "1";
  const shippingInCentsInput = pesosToCents(String(formData.get("shippingPesos") || ""));

  if ((!customerId && !empresaId && !contactoId) || !productId) {
    return redirect(mergeQuery(returnTo, { error: "missing_contact_or_company_or_product" }));
  }

  try {
    await assertCsrfToken(formData);
    let resolvedCustomerId = customerId;
    let resolvedEmpresaId = empresaId;
    let resolvedContactoId = contactoId;

    if (!resolvedCustomerId && (resolvedEmpresaId || resolvedContactoId)) {
      if (resolvedEmpresaId) {
        const empresa = await prisma.empresa.findUnique({
          where: { id: resolvedEmpresaId },
          include: { contactoPrincipal: true }
        });
        if (!empresa) {
          return redirect(mergeQuery(returnTo, { error: "empresa_no_encontrada" }));
        }
        if (tenantIds.length) {
          const empresaTenantId = String(empresa.tenantId || "").trim();
          if (empresaTenantId && !tenantIds.includes(empresaTenantId)) {
            return redirect(mergeQuery(returnTo, { error: "empresa_no_pertenece_canal" }));
          }
        }
        if (!empresa.contactoPrincipal) {
          return redirect(mergeQuery(returnTo, { error: "empresa_sin_contacto_principal" }));
        }
        resolvedContactoId = empresa.contactoPrincipal.id;
        const contact = empresa.contactoPrincipal;
        const existingCustomer =
          (contact.email
            ? await prisma.customer.findFirst({ where: { email: contact.email } })
            : null) ||
          (contact.telefono
            ? await prisma.customer.findFirst({ where: { phone: contact.telefono } })
            : null);
        if (existingCustomer) {
          resolvedCustomerId = existingCustomer.id;
        } else {
          const created = await prisma.customer.create({
            data: {
              name: contact.nombre,
              email: contact.email || null,
              phone: contact.telefono || null,
              tenantId: tenantIds[0] || null,
              metadata: {
                empresaId: empresa.id,
                contactoId: contact.id
              }
            }
          });
          resolvedCustomerId = created.id;
        }
      } else if (resolvedContactoId) {
        const contacto = await prisma.contacto.findUnique({
          where: { id: resolvedContactoId },
          include: { empresa: true }
        });
        if (!contacto) {
          return redirect(mergeQuery(returnTo, { error: "contacto_no_encontrado" }));
        }
        if (tenantIds.length) {
          const contactoTenantId = String(contacto?.empresa?.tenantId || "").trim();
          if (contactoTenantId && !tenantIds.includes(contactoTenantId)) {
            return redirect(mergeQuery(returnTo, { error: "contacto_no_pertenece_canal" }));
          }
        }
        resolvedEmpresaId = contacto.empresaId;
        const existingCustomer =
          (contacto.email
            ? await prisma.customer.findFirst({ where: { email: contacto.email } })
            : null) ||
          (contacto.telefono
            ? await prisma.customer.findFirst({ where: { phone: contacto.telefono } })
            : null);
        if (existingCustomer) {
          resolvedCustomerId = existingCustomer.id;
        } else {
          const created = await prisma.customer.create({
            data: {
              name: contacto.nombre,
              email: contacto.email || null,
              phone: contacto.telefono || null,
              tenantId: tenantIds[0] || null,
              metadata: {
                empresaId: contacto.empresaId,
                contactoId: contacto.id
              }
            }
          });
          resolvedCustomerId = created.id;
        }
      }
    }

    if (!resolvedCustomerId) {
      return redirect(mergeQuery(returnTo, { error: "customer_required" }));
    }

    const customer = (await getCustomerById(resolvedCustomerId)) as any;
    if (tenantIds.length) {
      const customerTenantId = String(customer?.tenantId || "").trim();
      if (customerTenantId && !tenantIds.includes(customerTenantId)) {
        return redirect(
          mergeQuery(returnTo, {
            error: "El contacto no pertenece al canal seleccionado.",
            customerId: resolvedCustomerId,
            ...(tenantId ? { tenantId } : {})
          })
        );
      }
    }
    const meta = customer?.metadata || {};
    const paymentSource =
      meta?.wompi?.paymentSourceId ||
      meta?.wompi?.payment_source_id ||
      meta?.paymentSourceId ||
      meta?.payment_source_id;
    const hasToken = Boolean(paymentSource);

    const settings = await getAdminSettings().catch(() => null);
    const checkoutConfig = (settings as any)?.checkoutConfig || {};
    const planBase = normalizeCheckoutBase(String(checkoutConfig?.planBaseUrl || "").trim(), "plan");
    const subBase = normalizeCheckoutBase(String(checkoutConfig?.subscriptionBaseUrl || "").trim(), "suscripcion");
    if (billingType === "PLAN" && !planBase) {
      return redirect(
        mergeQuery(returnTo, {
          error: "missing_plan_base_url",
          customerId: resolvedCustomerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }
    if (billingType === "SUBSCRIPCION" && !hasToken && !subBase) {
      return redirect(
        mergeQuery(returnTo, {
          error: "missing_subscription_base_url",
          customerId: resolvedCustomerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }

    const product = await getCatalogProductById({ productId, tenantId: tenantId || null });
    const item = product.ok ? product.item : null;
    if (!item) throw new Error("producto_no_encontrado");

    const variants = Array.isArray(item.variants) ? item.variants : [];
    const matched = variants.find(
      (v: any) => String(v?.option1 || "") === String(option1Value || "") && String(v?.option2 || "") === String(option2Value || "")
    );
    const delta = matched?.priceDeltaInCents ? Number(matched.priceDeltaInCents) : 0;

    const shippingForThisSubscription =
      String(item.kind || "").toUpperCase() === "PRODUCT" && Boolean(item.requiresShipping)
        ? shippingInCentsInput
        : 0;
    if (String(item.kind || "").toUpperCase() === "PRODUCT" && Boolean(item.requiresShipping) && shippingForThisSubscription <= 0) {
      return redirect(
        mergeQuery(returnTo, {
          error: "missing_shipping_amount",
          customerId: resolvedCustomerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }

    const totals = computeTotalInCents({
      basePriceInCents: Number(item.basePriceInCents || 0),
      variantDeltaInCents: delta,
      shippingInCents: shippingForThisSubscription,
      itemKind: String(item.kind || ""),
      discountType: item.discountType,
      discountValueInCents: item.discountValueInCents,
      discountPercent: item.discountPercent,
      taxPercent: item.taxPercent
    });

    if (!totals.totalInCents || totals.totalInCents <= 0) throw new Error("monto_invalido");

    const collectionMode = billingType === "PLAN" ? "AUTO_LINK" : "AUTO_DEBIT";

    const templateCandidate = templateIdRaw
      ? await getCheckoutTemplateById({ id: templateIdRaw, tenantId: tenantId || null })
          .then((r) => (r.ok ? r.item : null))
          .catch(() => null)
      : null;
    const template =
      templateCandidate &&
      String(templateCandidate.kind || "").toUpperCase() === (billingType === "PLAN" ? "PLAN" : "SUBSCRIPTION")
        ? templateCandidate
        : null;

    const nameSuffix = `${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-${resolvedCustomerId.slice(0, 6)}`;
    const createdPlan = await createPlanService({
      tenantIds,
      name: `${billingType === "PLAN" ? "Plan" : "Suscripción"} - ${item.name} - ${nameSuffix}`,
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
          shippingInCents: shippingForThisSubscription,
          totalInCents: totals.totalInCents
        }
      }
    });
    if (!createdPlan.ok) throw new Error(createdPlan.error);

    const planId = (createdPlan as any)?.plan?.id ? String((createdPlan as any).plan.id) : "";
    if (!planId) throw new Error("create_plan_failed");

    const shouldCreateLink = billingType === "PLAN" && submitAction === "LINK_NOW";
    let startAtValue = startAt || "";
    let endAtValue = firstPeriodEndAt || "";
    const sub = await createSubscription({
      customerId: resolvedCustomerId,
      empresaId: resolvedEmpresaId || undefined,
      contactoId: resolvedContactoId || undefined,
      planId,
      tenantIds,
      metadata: template?.id ? { templateId: String(template.id) } : undefined,
      startAt: startAtValue || undefined,
      firstPeriodEndAt: endAtValue || undefined,
      allowDuplicate,
      createPaymentLink: shouldCreateLink
    });
    if (!sub.ok) throw new Error(sub.error);
    const subscriptionId = String((sub as any)?.subscription?.id || "").trim();
    if (!subscriptionId) throw new Error("create_subscription_failed");

    const checkoutUrl = (sub as any)?.checkoutUrl ? String((sub as any).checkoutUrl) : "";
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
    const ttlHours = Number.isFinite(Number(expiryHours)) && Number(expiryHours) > 0 ? Math.min(Math.max(Math.trunc(Number(expiryHours)), 1), 168) : 24;

    if (billingType === "PLAN" && checkoutUrl) {
      const base = planBase;
      const token = await signPublicToken({
        sub: resolvedCustomerId || "customer",
        scope: "payment",
        ttlSeconds: ttlHours * 60 * 60
      });
      const baseUrl = `${base.replace(/\/$/, "")}/public/plan/${token}`;
    const utm = String(template?.utmParams || checkoutConfig?.defaultUtmParams || "").trim();
      const url = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
      const prevMeta =
        customer?.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};
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
      await updateCustomerProfile({ customerId: resolvedCustomerId, metadata: nextMeta }).catch(() => {});

      const rulesActive = await hasNotificationRule("PAYMENT_LINK_CREATED");
      if (rulesActive === false) {
        const content = buildChatwootLinkMessage({
          name: customer?.name || "Cliente",
          lead: "Aquí está tu link de pago:",
          url
        });
        await sendChatwootMessageSafe({ customerId: resolvedCustomerId, content });
      }

      redirect(
        mergeQuery(returnTo, {
          created: "1",
          checkoutUrl: url,
          customerId: resolvedCustomerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }

    if (billingType === "SUBSCRIPCION") {
      if (hasToken) {
        redirect(mergeQuery(returnTo, { created: "1", customerId: resolvedCustomerId, ...(tenantId ? { tenantId } : {}) }));
      }
      if (submitAction !== "LINK_NOW") {
        redirect(mergeQuery(returnTo, { created: "1", customerId: resolvedCustomerId, ...(tenantId ? { tenantId } : {}) }));
      }
      const base = subBase;
      const token = await signPublicToken({
        sub: resolvedCustomerId || "customer",
        scope: "tokenization",
        ttlSeconds: ttlHours * 60 * 60
      });
      const baseUrl = `${base.replace(/\/$/, "")}/public/suscripcion/${token}`;
      const utm = String(template?.utmParams || checkoutConfig?.defaultUtmParams || "").trim();
      const url = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
      const prevMeta =
        customer?.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};
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
      await updateCustomerProfile({ customerId: resolvedCustomerId, metadata: nextMeta }).catch(() => {});

      let rulesActive: boolean | null = null;
      try {
        const scheduled = await scheduleTokenizationLinkNotifications({ customerId: resolvedCustomerId, tokenUrl: url, forceNow: true });
        rulesActive = Boolean(scheduled?.rulesActive);
      } catch {
        rulesActive = null;
      }
      if (rulesActive === false) {
        const content = buildChatwootLinkMessage({
          name: customer?.name || "Cliente",
          lead: "Activa tu suscripción guardando tu método de pago aquí:",
          url
        });
        await sendChatwootMessageSafe({ customerId: resolvedCustomerId, content });
      }

      redirect(mergeQuery(returnTo, { created: "1", checkoutUrl: url, customerId: resolvedCustomerId, ...(tenantId ? { tenantId } : {}) }));
    }

    if (checkoutUrl) {
      redirect(
        mergeQuery(returnTo, {
          created: "1",
          checkoutUrl,
          customerId: resolvedCustomerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }
    redirect(mergeQuery(returnTo, { created: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const friendly = humanizeCreateError(String(err?.message || "create_plan_and_subscription_failed"));
    redirect(mergeQuery(returnTo, { error: friendly, ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function sendChatwootPaymentLink(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const checkoutUrl = String(formData.get("checkoutUrl") || "").trim();
  const customerId = String(formData.get("customerId") || "").trim();
  if (!checkoutUrl || !customerId) return redirect(mergeQuery(returnTo, { error: "missing_checkout_or_customer" }));

  const content = buildChatwootLinkMessage({
    name: "Cliente",
    lead: "Aquí está tu link de pago:",
    url: checkoutUrl
  });

  try {
    await sendChatwootMessageForCustomer({ customerId, content });
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
  const amountPesosRaw = String(formData.get("amountPesos") || "").trim();
  const sendNow = String(formData.get("sendNow") || "").trim() === "1";
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!subscriptionId || !customerId) {
    return redirect(mergeQuery(returnTo, { error: "missing_subscription_or_customer", ...(tenantId ? { tenantId } : {}) }));
  }

  try {
    const amountInCents = amountPesosRaw ? pesosToCents(amountPesosRaw) : undefined;
    if (amountPesosRaw && (!amountInCents || amountInCents <= 0)) {
      return redirect(mergeQuery(returnTo, { error: "invalid_amount", ...(tenantId ? { tenantId } : {}) }));
    }
    const res = await createSubscriptionPaymentLink({ subscriptionId, tenantId: tenantId || null, ...(amountInCents ? { amountInCents } : {}) });
    if (!res.ok) throw new Error(res.error);
    const checkoutUrl = String((res as any)?.checkoutUrl || "").trim();
    if (!checkoutUrl) return redirect(mergeQuery(returnTo, { error: "checkout_url_missing", ...(tenantId ? { tenantId } : {}) }));

    let centralMode = "created";
    if (sendNow) {
      const rulesActive = await hasNotificationRule("PAYMENT_LINK_CREATED");
      centralMode = rulesActive === false ? "chatwoot" : "rules";
      if (rulesActive === false) {
        const content = buildChatwootLinkMessage({
          name: "Cliente",
          lead: "Aquí está tu link de pago:",
          url: checkoutUrl
        });
        await sendChatwootMessageSafe({ customerId, content });
      }
    }

    redirect(
      mergeQuery(returnTo, {
        central: sendNow ? "sent" : "created",
        centralMode,
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
      getAdminSettings().catch(() => null),
      getCustomerById(customerId).catch(() => null)
    ]);
    const checkoutConfig = (settings as any)?.checkoutConfig || {};
    const base = normalizeCheckoutBase(String(checkoutConfig?.subscriptionBaseUrl || "").trim(), "suscripcion");
    if (!base) {
      return redirect(mergeQuery(returnTo, { error: "missing_subscription_base_url", ...(tenantId ? { tenantId } : {}) }));
    }

    const expiryHours =
      Number.isFinite(Number(checkoutConfig?.tokenExpiryHours)) && Number(checkoutConfig?.tokenExpiryHours) > 0
        ? Math.min(Math.max(Math.trunc(Number(checkoutConfig?.tokenExpiryHours)), 1), 168)
        : 24;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
    const token = await signPublicToken({
      sub: customerId || "customer",
      scope: "tokenization",
      ttlSeconds: expiryHours * 60 * 60
    });
    const baseUrl = `${base.replace(/\/$/, "")}/public/suscripcion/${token}`;
    const utm = String(checkoutConfig?.defaultUtmParams || "").trim();
    const url = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;

    const customer = (customerRes || {}) as any;
    const prevMeta =
      customer?.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};
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
    await updateCustomerProfile({ customerId, metadata: nextMeta }).catch(() => {});

    let rulesActive: boolean | null = null;
    try {
      const scheduled = await scheduleTokenizationLinkNotifications({ customerId, tokenUrl: url, forceNow: true });
      rulesActive = Boolean(scheduled?.rulesActive);
    } catch {
      rulesActive = null;
    }
    if (rulesActive === false) {
      const content = buildChatwootLinkMessage({
        name: customer?.name || "Cliente",
        lead: "Activa tu suscripción guardando tu método de pago aquí:",
        url
      });
      await sendChatwootMessageSafe({ customerId, content });
    }

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
    const res = await deleteSubscriptionService({
      subscriptionId,
      tenantId: tenantId || null,
      force: true,
      purgePayments: true
    });
    if (!res.ok) throw new Error(res.error);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_subscription_failed");
    if (msg.includes("subscription_must_be_canceled")) {
      return redirect(`/billing?error=${encodeURIComponent("Primero cancela la suscripción para poder eliminarla.")}`);
    }
    if (msg.includes("subscription_has_payments") || msg.includes("use_purgePayments=1_to_delete_with_payments")) {
      return redirect(`/billing?error=${encodeURIComponent("No se puede borrar: la suscripción tiene pagos asociados.")}`);
    }
    if (msg.includes("subscription_has_dependencies")) {
      return redirect(`/billing?error=${encodeURIComponent("No se puede borrar: la suscripción tiene pagos o links asociados.")}`);
    }
    return redirect(`/billing?error=${encodeURIComponent(msg)}`);
  }

  try {
    const res = await deletePlanService({ planId, tenantId: tenantId || null, force: true });
    if (!res.ok) throw new Error(res.error);
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
