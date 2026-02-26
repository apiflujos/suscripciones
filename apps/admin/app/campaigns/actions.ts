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

export async function createCampaign(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/campaigns").trim() || "/campaigns";
  const name = String(formData.get("name") || "").trim();
  const smartListId = String(formData.get("smartListId") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const templateParamsRaw = String(formData.get("templateParams") || "").trim();
  if (!name || !smartListId || !content) {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_required_fields`);
  }
  let templateParams: any = undefined;
  if (templateParamsRaw) {
    try {
      templateParams = JSON.parse(templateParamsRaw);
    } catch {
      return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=invalid_template_params`);
    }
  }

  try {
    await adminFetch("/admin/comms/campaigns", {
      method: "POST",
      body: JSON.stringify({ name, smartListId: smartListId || undefined, content, templateParams })
    });
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}created=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function runCampaign(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/campaigns").trim() || "/campaigns";
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_id`);
  try {
    await adminFetch(`/admin/comms/campaigns/${encodeURIComponent(id)}/run`, { method: "POST" });
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}running=${encodeURIComponent(id)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
