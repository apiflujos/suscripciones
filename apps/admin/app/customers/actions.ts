"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { createCustomer as createCustomerService, updateCustomerProfile, deleteCustomerProfile } from "../admin/_services/customers";
import { createManualOrderForAdmin } from "../admin/_services/orders";
import { getNotificationsConfigForEnv } from "@suscripciones/core/services/notificationsConfig";
import { logger } from "@suscripciones/core/lib/logger";

function pesosToCents(input: string): number {
  const digits = String(input || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
}

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  if (raw.startsWith("/customers")) return raw;
  if (raw.startsWith("/billing")) return raw;
  if (raw.startsWith("/empresas")) return raw;
  if (raw.startsWith("/dashboard/empresas")) return raw;
  return "/customers";
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

export async function createCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const nameRaw = String(formData.get("name") || "").trim();
  const emailRaw = String(formData.get("email") || "").trim();
  const phoneRaw = String(formData.get("phone") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const addressLine1 = String(formData.get("addressLine1") || "").trim();
  const dept = String(formData.get("dept") || "").trim();
  const city = String(formData.get("city") || "").trim();
  const code5 = String(formData.get("code5") || "").trim();
  const dane8 = String(formData.get("dane8") || "").trim();
  const idType = String(formData.get("idType") || "").trim();
  const idNumber = String(formData.get("idNumber") || "").trim();

  if (!phoneRaw) {
    return redirect(mergeQuery(returnTo, { error: "telefono_requerido", ...(tenantId ? { tenantId } : {}) }));
  }

  try {
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

    const name = nameRaw || undefined;
    const email = emailRaw || undefined;
    const phone = phoneRaw || undefined;
    const res = await createCustomerService({
      data: {
        name,
        email: email || undefined,
        phone: phone || undefined,
        metadata
      } as any,
      tenantIds: tenantId ? [tenantId] : []
    });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { created: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_customer_failed"), ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function sendPaymentLinkForCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const amountInCents = pesosToCents(String(formData.get("amount") || ""));
  if (!customerId || amountInCents <= 0) {
    return redirect(`/customers?error=${encodeURIComponent("monto_invalido")}`);
  }

  try {
    const cfg = await getNotificationsConfigForEnv("PRODUCTION").catch((err: any) => {
      logger.warn({ err, customerId }, "Fallo cargando configuracion de notificaciones en sendPaymentLinkForCustomer");
      return null;
    });
    if (!cfg) return redirect(`/customers?error=${encodeURIComponent("missing_template")}`);
    const rules = Array.isArray((cfg as any)?.rules) ? (cfg as any).rules : [];
    const templates = Array.isArray((cfg as any)?.templates) ? (cfg as any).templates : [];
    const match = rules.find((r: any) => r?.enabled && r?.trigger === "PAYMENT_LINK_CREATED");
    const tpl = match ? templates.find((t: any) => String(t?.id || "") === String(match?.templateId || "")) : null;
    if (!tpl || !String((tpl as any)?.chatwootTemplate?.name || "").trim()) {
      return redirect(`/customers?error=${encodeURIComponent("missing_template")}`);
    }
    const reference = `CONTACT_${customerId.slice(0, 6)}_${Date.now()}`;
    const customerName = String(formData.get("customerName") || "").trim() || "Cliente";
    const orderRes = await createManualOrderForAdmin({
      customerId,
      reference,
      currency: "COP",
      lineItems: [{ name: `Pago de ${customerName}`, quantity: 1, unitPriceInCents: amountInCents }],
      sendChatwoot: true,
      source: "MANUAL"
    });
    if (!orderRes.ok) throw new Error(orderRes.error);
    redirect("/customers?paymentLink=sent");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/customers?error=${encodeURIComponent(err?.message || "create_payment_link_failed")}`);
  }
}

export async function updateCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  const scopeTenantId = String(formData.get("scopeTenantId") || formData.get("tenantId") || "").trim();
  const tenantIds = formData
    .getAll("tenantIds")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const primaryTenantId = String(formData.get("primaryTenantId") || "").trim();
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

  if (!id) return redirect(mergeQuery(returnTo, { error: "invalid_id" }));
  if (!phone) return redirect(mergeQuery(returnTo, { error: "telefono_requerido", ...(scopeTenantId ? { tenantId: scopeTenantId } : {}) }));

  try {
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

    const updated = await updateCustomerProfile({
      customerId: id,
      tenantId: scopeTenantId || null,
      tenantIds,
      primaryTenantId: primaryTenantId || null,
      name: name || "",
      email: email || "",
      phone: phone || "",
      ...(metadata ? { metadata } : {})
    });
    if (!updated.ok) throw new Error(updated.error);
    redirect(mergeQuery(returnTo, { updated: "1", ...(scopeTenantId ? { tenantId: scopeTenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "update_customer_failed"), ...(scopeTenantId ? { tenantId: scopeTenantId } : {}) }));
  }
}

export async function deleteCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!id) return redirect(mergeQuery(returnTo, { error: "invalid_id" }));
  try {
    const res = await deleteCustomerProfile({ customerId: id, tenantId: tenantId || null, force: true });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { deleted: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_customer_failed");
    if (msg.includes("customer_has_dependencies")) {
      return redirect(mergeQuery(returnTo, { error: "No se pudo borrar el contacto.", ...(tenantId ? { tenantId } : {}) }));
    }
    redirect(mergeQuery(returnTo, { error: msg, ...(tenantId ? { tenantId } : {}) }));
  }
}
