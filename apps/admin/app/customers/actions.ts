"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = process.env.API_ADMIN_TOKEN || "";

async function adminFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `request_failed_${res.status}`);
  return json;
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

    const metadata = address ? { address } : undefined;

    await adminFetch("/admin/customers", { method: "POST", body: JSON.stringify({ name, email, phone, metadata }) });
    redirect("/customers?created=1");
  } catch (err: any) {
    redirect(`/customers?error=${encodeURIComponent(err?.message || "create_customer_failed")}`);
  }
}
