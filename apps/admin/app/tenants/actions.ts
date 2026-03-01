"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { assertCsrfToken } from "../lib/csrf";
import { getRequiredApiBase } from "../lib/adminApi";

function mergeQuery(path: string, extra: Record<string, string | undefined>) {
  const url = new URL(path || "/", "http://localhost");
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

async function adminFetch(path: string, init: RequestInit) {
  const API_BASE = getRequiredApiBase();
  const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");
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

export async function createTenant(formData: FormData) {
  await assertCsrfToken(formData);
  const name = String(formData.get("name") || "").trim();
  const logoUrl = String(formData.get("logoUrl") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || "/";
  if (!name) return redirect(mergeQuery(returnTo, { error: "tenant_name_required" }));

  try {
    const res = await adminFetch("/admin/tenants", { method: "POST", body: JSON.stringify({ name, logoUrl }) });
    const tenantId = res?.tenant?.id ? String(res.tenant.id) : "";
    const url = new URL(returnTo, "http://localhost");
    if (tenantId) url.searchParams.set("tenantId", tenantId);
    url.searchParams.set("tenantCreated", "1");
    redirect(`${url.pathname}${url.search}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_tenant_failed") }));
  }
}

export async function updateTenant(formData: FormData) {
  await assertCsrfToken(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const logoUrl = String(formData.get("logoUrl") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || "/";
  if (!tenantId) return redirect(mergeQuery(returnTo, { error: "missing_tenant_id" }));
  if (!name) return redirect(mergeQuery(returnTo, { error: "tenant_name_required" }));

  try {
    await adminFetch(`/admin/tenants/${encodeURIComponent(tenantId)}`, {
      method: "PUT",
      body: JSON.stringify({ name, logoUrl })
    });
    redirect(mergeQuery(returnTo, { saved: "1" }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "update_tenant_failed") }));
  }
}

export async function deleteTenant(formData: FormData) {
  await assertCsrfToken(formData);
  const tenantId = String(formData.get("tenantId") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || "/";
  if (!tenantId) return redirect(mergeQuery(returnTo, { error: "missing_tenant_id" }));

  try {
    const API_BASE = getRequiredApiBase();
    const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");
    const res = await fetch(`${API_BASE}/admin/tenants/${encodeURIComponent(tenantId)}`, {
      method: "DELETE",
      headers: {
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, "x-admin-token": TOKEN } : {}),
        "content-type": "application/json"
      },
      cache: "no-store"
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 409 && json?.error === "tenant_has_data") {
        const details = json?.details || {};
        return redirect(
          mergeQuery(returnTo, {
            tenantDeleteBlocked: "1",
            tenantCustomers: details.customers ? String(details.customers) : undefined,
            tenantPlans: details.plans ? String(details.plans) : undefined,
            tenantSubscriptions: details.subscriptions ? String(details.subscriptions) : undefined,
            tenantPayments: details.payments ? String(details.payments) : undefined,
            tenantPaymentLinks: details.paymentLinks ? String(details.paymentLinks) : undefined,
            tenantCheckoutTemplates: details.checkoutTemplates ? String(details.checkoutTemplates) : undefined
          })
        );
      }
      throw new Error(json?.reason ? `${json?.error || "request_failed"}:${json.reason}` : json?.error || `request_failed_${res.status}`);
    }
    redirect(mergeQuery(returnTo, { deleted: "1" }));
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "delete_tenant_failed") }));
  }
}
