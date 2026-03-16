"use server";

import { redirect } from "next/navigation";
import { getAdminApiConfig } from "../lib/adminApi";
import { assertCsrfToken } from "../lib/csrf";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/\s+/g, " ").trim();
  return msg || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
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
  const returnTo = String(formData.get("returnTo") || "/smart-lists").trim() || "/smart-lists";
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const rulesRaw = String(formData.get("rules") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  let rules: any = { op: "and", rules: [] };
  try {
    rules = rulesRaw ? JSON.parse(rulesRaw) : { op: "and", rules: [] };
  } catch {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=invalid_rules_json`);
  }

  try {
    await adminFetch("/admin/comms/smart-lists", {
      method: "POST",
      body: JSON.stringify({ name, description, rules, enabled })
    });
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}created=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function previewSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/smart-lists").trim() || "/smart-lists";
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_id`);
  redirect(`/smart-lists?preview=${encodeURIComponent(id)}`);
}

export async function syncSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/smart-lists").trim() || "/smart-lists";
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_id`);

  try {
    const json = await adminFetch(`/admin/comms/smart-lists/${encodeURIComponent(id)}/sync`, { method: "POST" });
    const msg = `agregados:${json?.added ?? 0},removidos:${json?.removed ?? 0}`;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}synced=${encodeURIComponent(msg)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
