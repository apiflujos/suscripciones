"use server";

import { redirect } from "next/navigation";
import { getAdminApiConfig } from "../lib/adminApi";

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

export async function createCampaign(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const smartListId = String(formData.get("smartListId") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const templateParamsRaw = String(formData.get("templateParams") || "").trim();
  const templateParams = templateParamsRaw ? JSON.parse(templateParamsRaw) : undefined;

  try {
    await adminFetch("/admin/comms/campaigns", {
      method: "POST",
      body: JSON.stringify({ name, smartListId: smartListId || undefined, content, templateParams })
    });
    redirect("/campaigns?created=1");
  } catch (err) {
    redirect(`/campaigns?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function runCampaign(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect("/campaigns?error=missing_id");
  try {
    await adminFetch(`/admin/comms/campaigns/${encodeURIComponent(id)}/run`, { method: "POST" });
    redirect(`/campaigns?running=${encodeURIComponent(id)}`);
  } catch (err) {
    redirect(`/campaigns?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
