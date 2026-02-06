"use server";

import { redirect } from "next/navigation";
import { saAdminFetch } from "../../saApi";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function createUser(formData: FormData) {
  const tenantId = String(formData.get("tenantId") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "").trim();
  const active = String(formData.get("active") || "").trim() === "1";

  try {
    const res = await saAdminFetch("/admin/sa/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, email, password, role, active })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect(`/sa/users?tenantId=${encodeURIComponent(tenantId)}&created=1`);
  } catch (err) {
    redirect(`/sa/users?tenantId=${encodeURIComponent(tenantId)}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

