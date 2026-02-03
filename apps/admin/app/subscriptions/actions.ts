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

export async function createSubscription(formData: FormData) {
  const customerId = String(formData.get("customerId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  const createPaymentLink = String(formData.get("createPaymentLink") || "") === "on";

  const json = await adminFetch("/admin/subscriptions", {
    method: "POST",
    body: JSON.stringify({ customerId, planId, createPaymentLink })
  });

  const subId = json?.subscription?.id;
  const checkoutUrl = json?.checkoutUrl;
  if (subId && checkoutUrl) {
    redirect(`/subscriptions?created=1&checkoutUrl=${encodeURIComponent(checkoutUrl)}`);
  }
  redirect(`/subscriptions?created=1`);
}

export async function createPaymentLink(formData: FormData) {
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const json = await adminFetch(`/admin/subscriptions/${subscriptionId}/payment-link`, { method: "POST", body: JSON.stringify({}) });
  redirect(`/subscriptions?link=1&checkoutUrl=${encodeURIComponent(json.checkoutUrl || "")}`);
}

