"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { assertCsrfToken } from "../lib/csrf";

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

export async function createSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  const startAt = String(formData.get("startAt") || "").trim();
  const firstPeriodEndAt = String(formData.get("firstPeriodEndAt") || "").trim();
  const createPaymentLink = String(formData.get("createPaymentLink") || "") === "on";

  try {
    const json = await adminFetch("/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        planId,
        ...(startAt ? { startAt } : {}),
        ...(firstPeriodEndAt ? { firstPeriodEndAt } : {}),
        createPaymentLink
      })
    });

    const checkoutUrl = json?.checkoutUrl;
    if (checkoutUrl) {
      redirect(`/billing?created=1&checkoutUrl=${encodeURIComponent(checkoutUrl)}&customerId=${encodeURIComponent(customerId)}`);
    }
    redirect(`/billing?created=1`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "create_subscription_failed")}`);
  }
}

export async function createPaymentLink(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const customerId = String(formData.get("customerId") || "").trim();
  try {
    const json = await adminFetch(`/admin/subscriptions/${subscriptionId}/payment-link`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const qp = new URLSearchParams();
    qp.set("created", "1");
    if (json.checkoutUrl) qp.set("checkoutUrl", json.checkoutUrl);
    if (customerId) qp.set("customerId", customerId);
    redirect(`/billing?${qp.toString()}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "create_payment_link_failed")}`);
  }
}

export async function suspendSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    await adminFetch(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}/suspend`, {
      method: "POST",
      body: JSON.stringify({})
    });
    redirect("/billing?suspended=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "suspend_subscription_failed")}`);
  }
}

export async function cancelSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    await adminFetch(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({})
    });
    redirect("/billing?canceled=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "cancel_subscription_failed")}`);
  }
}

export async function resumeSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    await adminFetch(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}/resume`, {
      method: "POST",
      body: JSON.stringify({})
    });
    redirect("/billing?resumed=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "resume_subscription_failed")}`);
  }
}

export async function activateSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    await adminFetch(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}/activate`, {
      method: "POST",
      body: JSON.stringify({})
    });
    redirect("/billing?activated=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "activate_subscription_failed")}`);
  }
}

export async function createPlan(formData: FormData) {
  await assertCsrfToken(formData);
  const name = String(formData.get("name") || "").trim();
  const priceInCents = Number(String(formData.get("priceInCents") || "0"));
  const currency = String(formData.get("currency") || "COP").trim();
  const intervalUnit = String(formData.get("intervalUnit") || "MONTH").trim();
  const intervalCount = Number(String(formData.get("intervalCount") || "1"));
  const collectionMode = String(formData.get("collectionMode") || "MANUAL_LINK").trim();

  try {
    await adminFetch("/admin/plans", {
      method: "POST",
      body: JSON.stringify({ name, priceInCents, currency, intervalUnit, intervalCount, collectionMode })
    });
    redirect("/billing?created=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "create_plan_failed")}`);
  }
}
