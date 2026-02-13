"use server";

import { redirect } from "next/navigation";
import { saAdminFetch } from "../../saApi";
import { assertCsrfToken } from "../../../lib/csrf";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function upsertLimit(formData: FormData) {
  await assertCsrfToken(formData);
  const key = String(formData.get("key") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const periodType = String(formData.get("periodType") || "").trim();
  const moduleKeyRaw = String(formData.get("moduleKey") || "").trim();
  const moduleKey = moduleKeyRaw || null;
  const active = String(formData.get("active") || "").trim() === "1";
  try {
    const res = await saAdminFetch("/admin/sa/limits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, name, periodType, moduleKey, active })
    });
    if (!res.ok) throw new Error(res.json?.error || `request_failed_${res.status}`);
    redirect("/sa/limits?saved=1");
  } catch (err) {
    redirect(`/sa/limits?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
