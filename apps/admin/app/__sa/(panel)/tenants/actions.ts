"use server";

import { redirect } from "next/navigation";
import { saAdminFetch } from "../../saApi";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function createTenant(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  try {
    const res = await saAdminFetch("/admin/sa/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect("/__sa/tenants?created=1");
  } catch (err) {
    redirect(`/__sa/tenants?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function setTenantActive(formData: FormData) {
  const tenantId = String(formData.get("tenantId") || "").trim();
  const active = String(formData.get("active") || "").trim() === "1";
  try {
    const res = await saAdminFetch(`/admin/sa/tenants/${encodeURIComponent(tenantId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect("/__sa/tenants?saved=1");
  } catch (err) {
    redirect(`/__sa/tenants?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function assignPlan(formData: FormData) {
  const tenantId = String(formData.get("tenantId") || "").trim();
  const planId = String(formData.get("planId") || "").trim();
  try {
    const res = await saAdminFetch(`/admin/sa/tenants/${encodeURIComponent(tenantId)}/assign-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect("/__sa/tenants?assigned=1");
  } catch (err) {
    redirect(`/__sa/tenants?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

