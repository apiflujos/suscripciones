"use server";

import { redirect } from "next/navigation";
import { getAdminApiConfig } from "../lib/adminApi";
import { assertCsrfToken } from "../lib/csrf";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/\s+/g, " ").trim();
  return msg || "unknown_error";
}

async function adminFetch(path: string, init: RequestInit) {
  const { apiBase, token } = getAdminApiConfig();
  if (!token) throw new Error("missing_admin_token");
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      ...(init.headers || {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const apiErr = String(json?.error || "").trim();
    throw new Error(apiErr || `request_failed_${res.status}`);
  }
  return json;
}

export async function createSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const rulesRaw = String(formData.get("rules") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  let rules: any = { op: "and", rules: [] };
  try {
    rules = rulesRaw ? JSON.parse(rulesRaw) : { op: "and", rules: [] };
  } catch {
    return redirect("/smart-lists?error=invalid_rules_json");
  }

  try {
    await adminFetch("/admin/comms/smart-lists", {
      method: "POST",
      body: JSON.stringify({ name, description, rules, enabled })
    });
    redirect("/smart-lists?created=1");
  } catch (err) {
    redirect(`/smart-lists?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function previewSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect("/smart-lists?error=missing_id");
  redirect(`/smart-lists?preview=${encodeURIComponent(id)}`);
}

export async function syncSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect("/smart-lists?error=missing_id");

  try {
    const json = await adminFetch(`/admin/comms/smart-lists/${encodeURIComponent(id)}/sync`, { method: "POST" });
    const msg = `agregados:${json?.added ?? 0},removidos:${json?.removed ?? 0}`;
    redirect(`/smart-lists?synced=${encodeURIComponent(msg)}`);
  } catch (err) {
    redirect(`/smart-lists?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
