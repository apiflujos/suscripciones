"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { assertCsrfToken } from "../lib/csrf";
import { getRequiredApiBase } from "../lib/adminApi";

const API_BASE = getRequiredApiBase();
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

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

export async function createCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const addressLine1 = String(formData.get("addressLine1") || "").trim();
  const dept = String(formData.get("dept") || "").trim();
  const city = String(formData.get("city") || "").trim();
  const code5 = String(formData.get("code5") || "").trim();
  const dane8 = String(formData.get("dane8") || "").trim();
  const idType = String(formData.get("idType") || "").trim();
  const idNumber = String(formData.get("idNumber") || "").trim();

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

    await adminFetch("/admin/customers", { method: "POST", body: JSON.stringify({ name, email, phone, metadata, tenantId }) });
    const qs = new URLSearchParams({ created: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/customers?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "create_customer_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/customers?${qs}`);
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
    const reference = `CONTACT_${customerId.slice(0, 6)}_${Date.now()}`;
    const customerName = String(formData.get("customerName") || "").trim() || "Cliente";
    await adminFetch("/admin/orders", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        reference,
        currency: "COP",
        lineItems: [{ name: `Pago de ${customerName}`, quantity: 1, unitPriceInCents: amountInCents }],
        sendChatwoot: true,
        source: "MANUAL"
      })
    });
    redirect("/customers?paymentLink=sent");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/customers?error=${encodeURIComponent(err?.message || "create_payment_link_failed")}`);
  }
}

export async function updateCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
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

  if (!id) return redirect(`/customers?error=${encodeURIComponent("invalid_id")}`);

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

    await adminFetch(`/admin/customers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...(tenantId ? { tenantId } : {}),
        name: name || "",
        email: email || "",
        phone: phone || "",
        ...(metadata ? { metadata } : {})
      })
    });
    const qs = new URLSearchParams({ updated: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/customers?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "update_customer_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/customers?${qs}`);
  }
}

export async function deleteCustomer(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!id) return redirect(`/customers?error=${encodeURIComponent("invalid_id")}`);
  try {
    const path = tenantId ? `/admin/customers/${encodeURIComponent(id)}?tenantId=${encodeURIComponent(tenantId)}` : `/admin/customers/${encodeURIComponent(id)}`;
    await adminFetch(path, { method: "DELETE" });
    const qs = new URLSearchParams({ deleted: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/customers?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_customer_failed");
    if (msg.includes("customer_has_dependencies")) {
      const qs = new URLSearchParams({
        error: "No se puede borrar: tiene suscripciones o pagos asociados.",
        ...(tenantId ? { tenantId } : {})
      }).toString();
      return redirect(`/customers?${qs}`);
    }
    const qs = new URLSearchParams({ error: msg, ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/customers?${qs}`);
  }
}
