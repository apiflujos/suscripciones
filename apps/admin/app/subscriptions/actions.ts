"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import {
  createSubscription as createSubscriptionService,
  createSubscriptionPaymentLink,
  updateSubscriptionStatus,
  deleteSubscription as deleteSubscriptionService,
  mergeDuplicateSubscriptions as mergeDuplicateSubscriptionsService
} from "../admin/_services/subscriptions";
import { createPlan as createPlanService } from "../admin/_services/plans";

function mergeQuery(path: string, extra: Record<string, string | undefined>) {
  const raw = String(path || "").trim();
  const safePath = raw.startsWith("/billing") || raw.startsWith("/customers") || raw.startsWith("/products") ? raw : "/billing";
  const [pathname, query = ""] = safePath.split("?");
  const sp = new URLSearchParams(query);
  Object.entries(extra).forEach(([k, v]) => {
    if (typeof v === "string" && v.length) sp.set(k, v);
  });
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
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
    const res = await createSubscriptionService({
      customerId,
      planId,
      tenantIds: tenantId ? [tenantId] : [],
      startAt: startAt || undefined,
      firstPeriodEndAt: firstPeriodEndAt || undefined,
      createPaymentLink
    });
    if (!res.ok) throw new Error(res.error);
    const checkoutUrl = (res as any)?.checkoutUrl;
    if (checkoutUrl) {
      const qs = new URLSearchParams({ created: "1", linkSent: "1", checkoutUrl, customerId, ...(tenantId ? { tenantId } : {}) }).toString();
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
    const res = await createSubscriptionPaymentLink({
      subscriptionId,
      tenantId: tenantId || null
    });
    if (!res.ok) throw new Error(res.error);
    const qp = new URLSearchParams();
    qp.set("created", "1");
    qp.set("linkSent", "1");
    if ((res as any).checkoutUrl) qp.set("checkoutUrl", String((res as any).checkoutUrl));
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
    const res = await updateSubscriptionStatus({ subscriptionId, tenantId: tenantId || null, action: "suspend" });
    if (!res.ok) throw new Error(res.error);
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
    const res = await updateSubscriptionStatus({ subscriptionId, tenantId: tenantId || null, action: "cancel" });
    if (!res.ok) throw new Error(res.error);
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
    const res = await updateSubscriptionStatus({ subscriptionId, tenantId: tenantId || null, action: "resume" });
    if (!res.ok) throw new Error(res.error);
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
    const res = await updateSubscriptionStatus({ subscriptionId, tenantId: tenantId || null, action: "activate" });
    if (!res.ok) throw new Error(res.error);
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
  const returnTo = String(formData.get("returnTo") || "/billing").trim();
  if (!subscriptionId) return redirect(`/billing?error=${encodeURIComponent("invalid_subscription_id")}`);
  try {
    const res = await deleteSubscriptionService({
      subscriptionId,
      tenantId: tenantId || null,
      force: true,
      purgePayments: true
    });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { deleted: "1", ...(tenantId ? { tenantId } : {}) }));
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
    redirect(mergeQuery(returnTo, { error: msg, ...(tenantId ? { tenantId } : {}) }));
  }
}

export async function mergeDuplicateSubscriptions(formData: FormData) {
  await assertCsrfToken(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  const keepSubscriptionId = String(formData.get("keepSubscriptionId") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const returnTo = String(formData.get("returnTo") || "/billing").trim();
  if (!customerId || !planId) {
    return redirect(mergeQuery(returnTo, { error: "missing_customer_or_plan", ...(tenantId ? { tenantId } : {}) }));
  }
  try {
    const res = await mergeDuplicateSubscriptionsService({
      customerId,
      planId,
      keepSubscriptionId: keepSubscriptionId || undefined,
      tenantId: tenantId || null
    });
    if (!res.ok) throw new Error(res.error);
    redirect(mergeQuery(returnTo, { mergedSubscriptions: "1", ...(tenantId ? { tenantId } : {}) }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    const msg = String(err?.message || "merge_duplicates_failed");
    if (msg.includes("no_duplicates_found")) {
      return redirect(mergeQuery(returnTo, { error: "No hay suscripciones duplicadas para fusionar.", ...(tenantId ? { tenantId } : {}) }));
    }
    return redirect(mergeQuery(returnTo, { error: msg, ...(tenantId ? { tenantId } : {}) }));
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
  const tenantId = String(formData.get("tenantId") || "").trim();
  const tenantIds = tenantId ? [tenantId] : [];

  try {
    const res = await createPlanService({
      tenantIds,
      name,
      priceInCents,
      currency,
      intervalUnit: intervalUnit as any,
      intervalCount,
      collectionMode: collectionMode as any
    });
    if (!res.ok) throw new Error(res.error);
    redirect("/billing?created=1");
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(`/billing?error=${encodeURIComponent(err?.message || "create_plan_failed")}`);
  }
}
