"use server";

import { redirect } from "next/navigation";
import { saAdminFetch } from "../../saApi";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function resetCounters(formData: FormData) {
  const tenantId = String(formData.get("tenantId") || "").trim();
  const periodKey = String(formData.get("periodKey") || "").trim();
  try {
    const res = await saAdminFetch("/admin/sa/usage/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, periodKey })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect(`/__sa/usage?tenantId=${encodeURIComponent(tenantId)}&periodKey=${encodeURIComponent(periodKey)}&reset=1`);
  } catch (err) {
    redirect(`/__sa/usage?tenantId=${encodeURIComponent(tenantId)}&periodKey=${encodeURIComponent(periodKey)}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function consumeTest(formData: FormData) {
  const tenantId = String(formData.get("tenantId") || "").trim();
  const periodKey = String(formData.get("periodKey") || "").trim();
  const serviceKey = String(formData.get("serviceKey") || "").trim();
  const amount = Number(formData.get("amount") || 1);
  const source = String(formData.get("source") || "").trim();
  try {
    const res = await saAdminFetch("/admin/sa/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, serviceKey, amount, source })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect(`/__sa/usage?tenantId=${encodeURIComponent(tenantId)}&periodKey=${encodeURIComponent(periodKey)}&consumed=1`);
  } catch (err) {
    redirect(
      `/__sa/usage?tenantId=${encodeURIComponent(tenantId)}&periodKey=${encodeURIComponent(periodKey)}&error=${encodeURIComponent(toShortErrorMessage(err))}`
    );
  }
}
