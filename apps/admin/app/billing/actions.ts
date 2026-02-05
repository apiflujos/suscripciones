"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = String(process.env.API_ADMIN_TOKEN || process.env.ADMIN_API_TOKEN || "").replace(/^Bearer\s+/i, "").trim();

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
  if (!res.ok) throw new Error(json?.error || `request_failed_${res.status}`);
  return json;
}

export async function createCustomerFromBilling(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const idType = String(formData.get("idType") || "").trim();
  const idNumber = String(formData.get("idNumber") || "").trim();

  const identificacion = idType && idNumber ? `${idType} ${idNumber}` : idNumber || "";
  const metadata = identificacion
    ? { identificacion, identificacionTipo: idType || null, identificacionNumero: idNumber || null }
    : undefined;

  try {
    const json = await adminFetch("/admin/customers", {
      method: "POST",
      body: JSON.stringify({ name, email: email || undefined, phone: phone || undefined, metadata })
    });
    const id = json?.customer?.id ? String(json.customer.id) : "";
    redirect(`/billing?contactCreated=1${id ? `&selectCustomerId=${encodeURIComponent(id)}` : ""}`);
  } catch (err: any) {
    redirect(`/billing?error=${encodeURIComponent(err?.message || "create_customer_failed")}`);
  }
}
