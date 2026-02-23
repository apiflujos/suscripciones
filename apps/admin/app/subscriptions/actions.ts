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
  const tenantId = String(formData.get("tenantId") || "").trim();
  const startAt = String(formData.get("startAt") || "").trim();
  const firstPeriodEndAt = String(formData.get("firstPeriodEndAt") || "").trim();
  const createPaymentLink = String(formData.get("createPaymentLink") || "") === "on";

  try {
    const json = await adminFetch("/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        planId,
        ...(tenantId ? { tenantId } : {}),
        ...(startAt ? { startAt } : {}),
        ...(firstPeriodEndAt ? { firstPeriodEndAt } : {}),
        createPaymentLink
      })
    });

    const checkoutUrl = json?.checkoutUrl;
    if (checkoutUrl) {
      const qs = new URLSearchParams({ created: "1", checkoutUrl, customerId, ...(tenantId ? { tenantId } : {}) }).toString();
      redirect(`/billing?${qs}`);
    }
    const qs = new URLSearchParams({ created: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "create_subscription_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  }
}

export async function createPaymentLink(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const customerId = String(formData.get("customerId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  try {
    const path = tenantId ? `/admin/subscriptions/${subscriptionId}/payment-link?tenantId=${encodeURIComponent(tenantId)}` : `/admin/subscriptions/${subscriptionId}/payment-link`;
    const json = await adminFetch(path, {
      method: "POST",
      body: JSON.stringify({})
    });
    const qp = new URLSearchParams();
    qp.set("created", "1");
    if (json.checkoutUrl) qp.set("checkoutUrl", json.checkoutUrl);
    if (customerId) qp.set("customerId", customerId);
    if (tenantId) qp.set("tenantId", tenantId);
    redirect(`/billing?${qp.toString()}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "create_payment_link_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  }
}

export async function suspendSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    const path = tenantId ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/suspend?tenantId=${encodeURIComponent(tenantId)}` : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/suspend`;
    await adminFetch(path, {
      method: "POST",
      body: JSON.stringify({})
    });
    const qs = new URLSearchParams({ suspended: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "suspend_subscription_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  }
}

export async function cancelSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    const path = tenantId ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/cancel?tenantId=${encodeURIComponent(tenantId)}` : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`;
    await adminFetch(path, {
      method: "POST",
      body: JSON.stringify({})
    });
    const qs = new URLSearchParams({ canceled: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "cancel_subscription_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  }
}

export async function resumeSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    const path = tenantId ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/resume?tenantId=${encodeURIComponent(tenantId)}` : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/resume`;
    await adminFetch(path, {
      method: "POST",
      body: JSON.stringify({})
    });
    const qs = new URLSearchParams({ resumed: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "resume_subscription_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  }
}

export async function activateSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    const path = tenantId ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/activate?tenantId=${encodeURIComponent(tenantId)}` : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}/activate`;
    await adminFetch(path, {
      method: "POST",
      body: JSON.stringify({})
    });
    const qs = new URLSearchParams({ activated: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const qs = new URLSearchParams({ error: String(err?.message || "activate_subscription_failed"), ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  }
}

export async function deleteSubscription(formData: FormData) {
  await assertCsrfToken(formData);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    const path = tenantId ? `/admin/subscriptions/${encodeURIComponent(subscriptionId)}?tenantId=${encodeURIComponent(tenantId)}` : `/admin/subscriptions/${encodeURIComponent(subscriptionId)}`;
    await adminFetch(path, {
      method: "DELETE"
    });
    const qs = new URLSearchParams({ deleted: "1", ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "delete_subscription_failed");
    if (msg.includes("subscription_must_be_canceled")) {
      const qs = new URLSearchParams({
        error: "Primero cancela la suscripción para poder eliminarla.",
        ...(tenantId ? { tenantId } : {})
      }).toString();
      return redirect(`/billing?${qs}`);
    }
    if (msg.includes("subscription_has_dependencies")) {
      const qs = new URLSearchParams({
        error: "No se puede borrar: tiene pagos o links asociados.",
        ...(tenantId ? { tenantId } : {})
      }).toString();
      return redirect(`/billing?${qs}`);
    }
    const qs = new URLSearchParams({ error: msg, ...(tenantId ? { tenantId } : {}) }).toString();
    redirect(`/billing?${qs}`);
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
