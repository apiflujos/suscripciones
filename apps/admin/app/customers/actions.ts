"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
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

    await adminFetch("/admin/customers", { method: "POST", body: JSON.stringify({ name, email, phone, metadata }) });
    redirect("/customers?created=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/customers?error=${encodeURIComponent(err?.message || "create_customer_failed")}`);
  }
}

export async function sendPaymentLinkForCustomer(formData: FormData) {
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
  const id = String(formData.get("id") || "").trim();
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
        name: name || "",
        email: email || "",
        phone: phone || "",
        ...(metadata ? { metadata } : {})
      })
    });
    redirect("/customers?updated=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/customers?error=${encodeURIComponent(err?.message || "update_customer_failed")}`);
  }
}

export async function deleteCustomer(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(`/customers?error=${encodeURIComponent("invalid_id")}`);
  try {
    await adminFetch(`/admin/customers/${encodeURIComponent(id)}`, { method: "DELETE" });
    redirect("/customers?deleted=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/customers?error=${encodeURIComponent(err?.message || "delete_customer_failed")}`);
  }
}
