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
import { resolveOperationalPlanForProduct } from "../admin/_services/productPlanMapping";
import { associatePaymentToSubscription } from "../admin/_services/logsActions";
import {
  createSubscription,
  createSubscriptionPaymentLink,
  chargeSubscriptionNow as chargeSubscriptionNowService,
  scheduleSubscriptionCutoff,
  recalcSubscriptionCutoff,
  updateSubscriptionTenants as updateSubscriptionTenantsService,
  updateSubscriptionBillingSettings as updateSubscriptionBillingSettingsService,
  changeSubscriptionPlan as changeSubscriptionPlanService,
  deleteSubscription as deleteSubscriptionService,
  markSubscriptionPaidManual as markSubscriptionPaidManualService,
  unmarkSubscriptionPaidManual as unmarkSubscriptionPaidManualService
} from "../admin/_services/subscriptions";
import { getAdminSettings } from "../admin/_services/settings";
import { findCheckoutTemplateForProductOrDefault } from "../admin/_services/checkoutTemplates";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { schedulePaymentLinkNotifications, scheduleTokenizationLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { createPublicCheckoutLink } from "@suscripciones/core/services/publicCheckoutLinks";
import { logger } from "@suscripciones/core/lib/logger";
import { isNotificationTemplateConfigured } from "../lib/notificationTemplate";

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  if (raw.startsWith("/billing") || raw.startsWith("/customers") || raw.startsWith("/products") || raw.startsWith("/payments")) return raw;
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
  if (msg.includes("missing_product_or_cutoff")) return "Falta seleccionar el producto o la fecha de cobro.";
  if (msg.includes("missing_shipping_amount")) return "Debes ingresar el valor del flete o activar envío gratis.";
  if (msg.includes("product_not_found")) return "No se encontró un producto activo válido para este cambio.";
  if (msg.includes("missing_subscription_base_url")) return "Falta configurar URL base de suscripción en Configuración.";
  if (msg.includes("missing_plan_base_url")) return "Falta configurar URL base de plan en Configuración.";
  if (msg.includes("missing_checkout_for_product")) return "No hay un checkout público asociado al producto seleccionado.";
  if (msg.includes("public_checkout_create_failed")) return "No se pudo generar el checkout público de débito automático.";
  if (msg.includes("payment_association_failed")) return "La suscripción se creó, pero no se pudo asociar automáticamente al pago recibido.";
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

async function hasNotificationRule(trigger: string, paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK"): Promise<boolean | null> {
  try {
    const cfg = await getNotificationsConfigForEnv("PRODUCTION");
    const rules = Array.isArray((cfg as any)?.rules) ? (cfg as any).rules : [];
    const templates = Array.isArray((cfg as any)?.templates) ? (cfg as any).templates : [];
    const candidates = rules.filter((r: any) => {
      if (!r?.enabled || r?.trigger !== trigger) return false;
      if (!paymentType) return true;
      const types = Array.isArray(r?.conditions?.requirePaymentTypeIn) ? r.conditions.requirePaymentTypeIn : [];
      return !types.length || types.includes(paymentType);
    });
    const match = candidates[0] || null;
    if (!match) return false;
    const tpl = templates.find((t: any) => String(t?.id || "") === String(match?.templateId || ""));
    return isNotificationTemplateConfigured(tpl);
  } catch {
    return null;
  }
}

async function getPaymentLinkNotificationTypeForSubscription(subscriptionId: string): Promise<"SUBSCRIPTION" | "LINK" | null> {
  const resolvedSubscriptionId = String(subscriptionId || "").trim();
  if (!resolvedSubscriptionId) return null;
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: resolvedSubscriptionId },
      select: { id: true }
    });
    return subscription?.id ? "SUBSCRIPTION" : null;
  } catch {
    return null;
  }
}

async function resolveSubscriptionPlanCheckoutTemplate(args: { subscriptionId: string; tenantId?: string | null }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return null;
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      customerId: true,
      tenantId: true,
      productId: true,
      metadata: true,
      plan: { select: { metadata: true } }
    }
  });
  if (!subscription) return null;

  const explicitTemplateId = String((subscription.metadata as any)?.templateId || "").trim();
  if (explicitTemplateId) {
    const explicit = await prisma.publicCheckoutTemplate.findUnique({ where: { id: explicitTemplateId } }).catch(() => null);
    if (explicit && explicit.active !== false && String(explicit.kind || "").toUpperCase() === "PLAN") {
      return { subscription, templateId: String(explicit.id) };
    }
  }

  const settings = await getAdminSettings().catch(() => null);
  const productId = String(subscription.productId || (subscription.plan as any)?.catalogProductId || (subscription.plan?.metadata as any)?.catalog?.itemId || "").trim();
  if (!productId) return null;
  const selected = await findCheckoutTemplateForProductOrDefault({
    tenantId: String(args.tenantId || subscription.tenantId || "").trim() || null,
    kind: "PLAN" as any,
    productId,
    defaultTemplateId: String((settings as any)?.checkoutConfig?.defaultPlanTemplateId || "").trim()
  });
  const templateId = selected ? String((selected as any).id || "") : "";
  return templateId ? { subscription, templateId } : null;
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
      } catch (err: any) {
        logger.warn({ err, subscriptionId: "new", variantsJson }, "JSON inválido en variantes al crear producto desde billing");
      }

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

// DEPRECATED: scheduleCutoff ahora redirige a usar chargeDate en lugar de cutoffAt
// La fecha de corte AHORA es la misma que la fecha de pago
export async function scheduleCutoff(formData: FormData) {
  const cutoffAt = String(formData.get("cutoffAt") || "").trim();
  const returnTo = String(formData.get("returnTo") || "/billing").trim();
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  
  // Redirigir con los parámetros correctos para setBillingChargeDate
  const qs = new URLSearchParams();
  if (subscriptionId) qs.set("subscriptionId", subscriptionId);
  if (cutoffAt) {
    qs.set("chargeDate", cutoffAt.split("T")[0] || cutoffAt);
    qs.set("chargeTime", cutoffAt.split("T")[1] || "10:00");
  }
  qs.set("returnTo", returnTo);
  
  redirect(`/billing?${qs.toString()}`);
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

export async function updateSubscriptionBillingSettings(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = mergeQuery(String(formData.get("returnTo") || "/billing"), {});
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const collectionMode = String(formData.get("collectionMode") || "").trim();
  const cycleStartDay = String(formData.get("cycleStartDay") || "").trim();
  const paymentDay = String(formData.get("paymentDay") || "").trim();
  const paymentTiming = String(formData.get("paymentTiming") || "").trim();
  const graceDays = String(formData.get("graceDays") || "").trim();

  if (!subscriptionId) {
    return redirect(mergeQuery(returnTo, { error: "missing_subscription_id", ...(tenantId ? { tenantId } : {}) }));
  }
  try {
    const res = await updateSubscriptionBillingSettingsService({
      subscriptionId,
      tenantId: tenantId || null,
      collectionMode: collectionMode || undefined,
      cycleStartDay,
      paymentDay,
      paymentTiming,
      graceDays,
      actor: "Sistema"
    });
    if (!res.ok) return redirect(mergeQuery(returnTo, { error: res.error || "update_failed", ...(tenantId ? { tenantId } : {}) }));
    redirect(mergeQuery(returnTo, { billingRulesUpdated: "1", subscriptionId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    const msg = String(err?.message || err || "update_failed");
    redirect(mergeQuery(returnTo, { error: msg, ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function movePaymentToCycle(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const paymentId = String(formData.get("paymentId") || "").trim();
  const cycleId = String(formData.get("cycleId") || "").trim();
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = sessionToken ? await verifyAdminSessionToken(sessionToken) : null;

  const res = await associatePaymentToSubscription({
    paymentId,
    cycleId,
    subscriptionId,
    tenantId: tenantId || undefined,
    actorEmail: session?.email || undefined
  });

  redirect(
    mergeQuery(returnTo, {
      payment_move: res.ok ? "1" : "0",
      payment_move_error: res.ok ? undefined : res.error
    })
  );
}

export async function autoAssociatePaymentToCycle(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const cycleId = String(formData.get("cycleId") || "").trim();
  const paymentId = String(formData.get("paymentId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();

  if (!subscriptionId || !cycleId || !paymentId) {
    return { ok: false, error: "missing_required_fields" };
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = sessionToken ? await verifyAdminSessionToken(sessionToken) : null;

  const res = await associatePaymentToSubscription({
    paymentId,
    cycleId,
    subscriptionId,
    tenantId: tenantId || undefined,
    actorEmail: session?.email || undefined
  });

  if (!res.ok) {
    return { ok: false, error: res.error || "association_failed" };
  }

  return { ok: true, message: "payment_associated" };
}

export async function changeSubscriptionPlan(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const productId = String(formData.get("productId") || "").trim();
  const cutoffAt = String(formData.get("cutoffAt") || "").trim();
  const shippingInCents = pesosToCents(String(formData.get("shippingPesos") || ""));
  const freeShipping = String(formData.get("freeShipping") || "").trim() === "1";
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!subscriptionId || !productId || !cutoffAt) {
    return redirect(mergeQuery(returnTo, { error: "missing_product_or_cutoff", ...(tenantId ? { tenantId } : {}) }));
  }

  try {
    const res = await changeSubscriptionPlanService({
      subscriptionId,
      productId,
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
  const submitActionRaw = String(formData.get("submitAction") || "").trim().toUpperCase();
  const submitAction = submitActionRaw === "LINK_NOW" ? "LINK_NOW" : "CREATE";
  const allowDuplicate = String(formData.get("allowDuplicate") || "").trim() === "1";
  const shippingInCentsInput = pesosToCents(String(formData.get("shippingPesos") || ""));
  const paymentId = String(formData.get("paymentId") || "").trim();

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

    const template = await findCheckoutTemplateForProductOrDefault({
      tenantId: tenantId || null,
      kind: billingType === "PLAN" ? "PLAN" : "SUBSCRIPTION",
      productId,
      defaultTemplateId:
        billingType === "PLAN"
          ? String(checkoutConfig?.defaultPlanTemplateId || "").trim()
          : String(checkoutConfig?.defaultSubscriptionTemplateId || "").trim()
    });
    if (!template) {
      return redirect(
        mergeQuery(returnTo, {
          error: "missing_checkout_for_product",
          customerId: resolvedCustomerId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }

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

    if (paymentId) {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
      const session = sessionToken ? await verifyAdminSessionToken(sessionToken) : null;
      const paymentAssociation = await associatePaymentToSubscription({
        paymentId,
        subscriptionId,
        tenantId: tenantId || undefined,
        actorEmail: session?.email || undefined
      });
      if (!paymentAssociation.ok) {
        throw new Error(`payment_association_failed:${paymentAssociation.error || "unknown"}`);
      }
    }

    const checkoutUrl = (sub as any)?.checkoutUrl ? String((sub as any).checkoutUrl) : "";

    if (billingType === "PLAN" && checkoutUrl) {
      const createdPaymentLink = await createPublicCheckoutLink({
        customerId: resolvedCustomerId,
        templateId: String(template?.id || ""),
        checkoutUrl
      });
      const url = String(createdPaymentLink?.url || "").trim();
      if (!url) throw new Error("public_checkout_create_failed");

      const rulesActive = await hasNotificationRule("PAYMENT_LINK_CREATED", "SUBSCRIPTION");
      if (shouldCreateLink && rulesActive !== true) {
        redirect(
          mergeQuery(returnTo, {
            error: "missing_template",
            checkoutUrl: url,
            customerId: resolvedCustomerId,
            subscriptionId,
            ...(tenantId ? { tenantId } : {})
          })
        );
      }

      redirect(
        mergeQuery(returnTo, {
          created: "1",
          checkoutUrl: url,
          customerId: resolvedCustomerId,
          subscriptionId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }

    if (billingType === "SUBSCRIPCION") {
      if (hasToken) {
        redirect(mergeQuery(returnTo, { created: "1", customerId: resolvedCustomerId, subscriptionId, ...(tenantId ? { tenantId } : {}) }));
      }
      if (submitAction !== "LINK_NOW") {
        redirect(mergeQuery(returnTo, { created: "1", customerId: resolvedCustomerId, subscriptionId, ...(tenantId ? { tenantId } : {}) }));
      }
      const rulesActive = await hasNotificationRule("TOKENIZATION_LINK_CREATED", "SUBSCRIPTION");
      if (rulesActive !== true) {
        redirect(
          mergeQuery(returnTo, {
            error: "missing_template",
            customerId: resolvedCustomerId,
            subscriptionId,
            ...(tenantId ? { tenantId } : {})
          })
        );
      }
      const createdTokenizationLink = await createPublicCheckoutLink({
        customerId: resolvedCustomerId,
        templateId: String(template?.id || ""),
        planId
      });
      const url = String(createdTokenizationLink?.url || "").trim();
      if (!url) throw new Error("public_checkout_create_failed");

      let notificationError = "";
      try {
        const scheduled = await scheduleTokenizationLinkNotifications({ customerId: resolvedCustomerId, tokenUrl: url, forceNow: true });
        notificationError = String((scheduled as any)?.errors?.[0] || "").trim();
      } catch (err: any) {
        logger.warn({ err, customerId: resolvedCustomerId, planId }, "Fallo programando notificaciones de tokenización");
      }
      if (notificationError) {
        redirect(
          mergeQuery(returnTo, {
            error: notificationError,
            checkoutUrl: url,
            customerId: resolvedCustomerId,
            subscriptionId,
            ...(tenantId ? { tenantId } : {})
          })
        );
      }

      redirect(mergeQuery(returnTo, { created: "1", checkoutUrl: url, customerId: resolvedCustomerId, subscriptionId, ...(tenantId ? { tenantId } : {}) }));
    }

    if (checkoutUrl) {
      redirect(
        mergeQuery(returnTo, {
          created: "1",
          checkoutUrl,
          customerId: resolvedCustomerId,
          subscriptionId,
          ...(tenantId ? { tenantId } : {})
        })
      );
    }
    redirect(mergeQuery(returnTo, { created: "1", subscriptionId, ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const friendly = humanizeCreateError(String(err?.message || "create_plan_and_subscription_failed"));
    redirect(mergeQuery(returnTo, { error: friendly, ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function sendWhatsAppPaymentLink(formData: FormData) {
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
    const planCheckout = await resolveSubscriptionPlanCheckoutTemplate({ subscriptionId, tenantId: tenantId || null });
    if (!planCheckout?.templateId) {
      return redirect(mergeQuery(returnTo, { error: "missing_checkout_for_product", ...(tenantId ? { tenantId } : {}) }));
    }

    const res = await createSubscriptionPaymentLink({
      subscriptionId,
      tenantId: tenantId || null,
      ...(amountInCents ? { amountInCents } : {}),
      sendNotifications: false
    });
    if (!res.ok) throw new Error(res.error);
    const checkoutUrl = String((res as any)?.checkoutUrl || "").trim();
    if (!checkoutUrl) return redirect(mergeQuery(returnTo, { error: "checkout_url_missing", ...(tenantId ? { tenantId } : {}) }));

    const publicLink = await createPublicCheckoutLink({
      customerId,
      templateId: planCheckout.templateId,
      checkoutUrl
    });
    const publicUrl = String(publicLink?.url || "").trim();
    if (!publicUrl) {
      return redirect(mergeQuery(returnTo, { error: "public_checkout_create_failed", ...(tenantId ? { tenantId } : {}) }));
    }

    if (sendNow) {
      const paymentNotificationType = await getPaymentLinkNotificationTypeForSubscription(subscriptionId);
      const rulesActive = paymentNotificationType
        ? await hasNotificationRule("PAYMENT_LINK_CREATED", paymentNotificationType)
        : null;
      if (rulesActive !== true) {
        return redirect(mergeQuery(returnTo, { error: "missing_template", ...(tenantId ? { tenantId } : {}) }));
      }
      const paymentId = String((res as any)?.paymentId || "").trim();
      const scheduled = paymentId
        ? await schedulePaymentLinkNotifications({ paymentId, forceNow: true })
        : null;
      const chatwootError = String((scheduled as any)?.errors?.[0] || "").trim();
      if (chatwootError) {
        return redirect(mergeQuery(returnTo, { error: chatwootError, checkoutUrl: publicUrl, customerId, subscriptionId, ...(tenantId ? { tenantId } : {}) }));
      }
    }

    redirect(
      mergeQuery(returnTo, {
        central: sendNow ? "sent" : "created",
        checkoutUrl: publicUrl,
        customerId,
        subscriptionId,
        ...(tenantId ? { tenantId } : {})
      })
    );
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "centralcom_send_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function sendWhatsAppTokenizationLink(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const productId = String(formData.get("productId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  const tenantIds = readTenantIds(formData);
  const tenantId = tenantIds[0] || "";
  if (!customerId) return redirect(mergeQuery(returnTo, { error: "missing_customer_id", ...(tenantId ? { tenantId } : {}) }));

  try {
    const [settings, customerRes, plan] = await Promise.all([
      getAdminSettings().catch(() => null),
      getCustomerById(customerId).catch(() => null),
      planId
        ? prisma.subscriptionPlan.findUnique({
            where: { id: planId },
            select: { metadata: true }
          }).catch(() => null)
        : Promise.resolve(null)
    ]);
    const checkoutConfig = (settings as any)?.checkoutConfig || {};
    const base = normalizeCheckoutBase(String(checkoutConfig?.subscriptionBaseUrl || "").trim(), "suscripcion");
    if (!base) {
      return redirect(mergeQuery(returnTo, { error: "missing_subscription_base_url", ...(tenantId ? { tenantId } : {}) }));
    }

    const resolvedProductId = productId || String((plan as any)?.catalogProductId || (plan?.metadata as any)?.catalog?.itemId || "").trim();
    if (!resolvedProductId) {
      return redirect(mergeQuery(returnTo, { error: "missing_checkout_for_product", ...(tenantId ? { tenantId } : {}) }));
    }

    const resolvedPlanId = planId
      ? planId
      : String(
          (
            await resolveOperationalPlanForProduct({
              productId: resolvedProductId,
              tenantId: tenantId || null
            }).catch(() => null)
          )?.id || ""
        ).trim();

    const template = resolvedProductId
      ? await findCheckoutTemplateForProductOrDefault({
          tenantId: tenantId || null,
          kind: "SUBSCRIPTION",
          productId: resolvedProductId,
          defaultTemplateId: String(checkoutConfig?.defaultSubscriptionTemplateId || "").trim()
        }).catch(() => null)
      : null;
    if (!template?.id) {
      return redirect(mergeQuery(returnTo, { error: "missing_checkout_for_product", ...(tenantId ? { tenantId } : {}) }));
    }

    if (!customerRes) {
      return redirect(mergeQuery(returnTo, { error: "customer_not_found", ...(tenantId ? { tenantId } : {}) }));
    }
    const rulesActive = await hasNotificationRule("TOKENIZATION_LINK_CREATED");
    if (rulesActive !== true) {
      return redirect(mergeQuery(returnTo, { error: "missing_template", ...(tenantId ? { tenantId } : {}) }));
    }

    const createdTokenizationLink = await createPublicCheckoutLink({
      customerId,
      templateId: String(template.id),
      planId: resolvedPlanId || null,
      productId: resolvedProductId || null
    });
    const url = String(createdTokenizationLink?.url || "").trim();
    if (!url) {
      return redirect(mergeQuery(returnTo, { error: "public_checkout_create_failed", ...(tenantId ? { tenantId } : {}) }));
    }

    let notificationError = "";
    try {
      const scheduled = await scheduleTokenizationLinkNotifications({ customerId, tokenUrl: url, forceNow: true });
      notificationError = String((scheduled as any)?.errors?.[0] || "").trim();
    } catch (err: any) {
      logger.warn({ err, customerId, planId: resolvedPlanId || planId, productId: resolvedProductId }, "Fallo programando notificaciones de tokenización en envío manual");
    }
    if (notificationError) {
      return redirect(mergeQuery(returnTo, { error: notificationError, ...(tenantId ? { tenantId } : {}) }));
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

export async function setBillingChargeDate(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const chargeDate = String(formData.get("chargeDate") || "").trim();
  const chargeTime = String(formData.get("chargeTime") || "").trim();
  const returnTo = String(formData.get("returnTo") || "/billing").trim();

  if (!subscriptionId || !chargeDate) {
    redirect(`${returnTo}?error=missing_charge_date`);
  }

  try {
    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        metadata: true
      }
    });

    if (!sub) {
      redirect(`${returnTo}?error=subscription_not_found`);
    }

    // Combinar fecha y hora
    const newChargeAt = new Date(`${chargeDate}T${chargeTime || "10:00"}`);
    if (Number.isNaN(newChargeAt.getTime())) {
      redirect(`${returnTo}?error=invalid_datetime`);
    }

    const res = await scheduleSubscriptionCutoff({
      subscriptionId,
      cutoffAt: newChargeAt.toISOString()
    });
    if (!res.ok) {
      redirect(`${returnTo}?error=${encodeURIComponent(String(res.error || "schedule_cutoff_failed"))}`);
    }

    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        metadata: {
          ...(sub as any).metadata,
          billing: {
            ...((sub as any).metadata?.billing || {}),
            lastChargeDateChange: new Date().toISOString(),
            chargeDateManuallySet: true
          }
        }
      }
    });

    // Actualizar job de reintento si existe
    await prisma.retryJob.updateMany({
      where: {
        type: "PAYMENT_RETRY",
        status: "PENDING",
        payload: { path: ["subscriptionId"], equals: subscriptionId }
      },
      data: {
        runAt: newChargeAt
      }
    });

    redirect(`${returnTo}?charge_date_updated=1`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "set_charge_date_failed");
    redirect(`${returnTo}?error=${encodeURIComponent(msg)}`);
  }
}
