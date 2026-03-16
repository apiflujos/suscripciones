"use server";

import { redirect } from "next/navigation";
import { fetchAdminCached } from "../../lib/adminApi";
import { assertCsrfToken } from "../../lib/csrf";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function createUser(formData: FormData) {
  await assertCsrfToken(formData);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "").trim();
  const active = String(formData.get("active") || "").trim() === "1";

  try {
    const res = await fetchAdminCached("/admin/settings/users", {
      ttlMs: 0,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, role, active })
    } as any);
    
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect(`/settings/users?created=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/settings/users?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
