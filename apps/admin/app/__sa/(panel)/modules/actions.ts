"use server";

import { redirect } from "next/navigation";
import { saAdminFetch } from "../../saApi";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function upsertModule(formData: FormData) {
  const key = String(formData.get("key") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const active = String(formData.get("active") || "").trim() === "1";
  try {
    const res = await saAdminFetch("/admin/sa/modules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, name, active })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect("/__sa/modules?saved=1");
  } catch (err) {
    redirect(`/__sa/modules?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function setTenantModule(formData: FormData) {
  const tenantId = String(formData.get("tenantId") || "").trim();
  const moduleKey = String(formData.get("moduleKey") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  try {
    const res = await saAdminFetch(`/admin/sa/tenants/${encodeURIComponent(tenantId)}/modules/${encodeURIComponent(moduleKey)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect(`/__sa/modules?tenantId=${encodeURIComponent(tenantId)}&saved=1`);
  } catch (err) {
    redirect(`/__sa/modules?tenantId=${encodeURIComponent(tenantId)}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

