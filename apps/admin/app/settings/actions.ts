"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = process.env.API_ADMIN_TOKEN || "";

async function adminFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `request_failed_${res.status}`);
  return json;
}

export async function updateWompi(formData: FormData) {
  const privateKey = String(formData.get("privateKey") || "").trim();
  const eventsSecret = String(formData.get("eventsSecret") || "").trim();
  const apiBaseUrl = String(formData.get("apiBaseUrl") || "").trim();
  const checkoutLinkBaseUrl = String(formData.get("checkoutLinkBaseUrl") || "").trim();
  const redirectUrl = String(formData.get("redirectUrl") || "").trim();

  await adminFetch("/admin/settings/wompi", {
    method: "PUT",
    body: JSON.stringify({
      ...(privateKey ? { privateKey } : {}),
      ...(eventsSecret ? { eventsSecret } : {}),
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      ...(checkoutLinkBaseUrl ? { checkoutLinkBaseUrl } : {}),
      redirectUrl
    })
  });
  redirect("/settings?saved=1");
}

export async function updateShopify(formData: FormData) {
  const forwardUrl = String(formData.get("forwardUrl") || "").trim();
  const forwardSecret = String(formData.get("forwardSecret") || "").trim();

  await adminFetch("/admin/settings/shopify", {
    method: "PUT",
    body: JSON.stringify({ forwardUrl, forwardSecret })
  });
  redirect("/settings?saved=1");
}

export async function updateChatwoot(formData: FormData) {
  const baseUrl = String(formData.get("baseUrl") || "").trim();
  const accountId = String(formData.get("accountId") || "").trim();
  const apiAccessToken = String(formData.get("apiAccessToken") || "").trim();
  const inboxId = String(formData.get("inboxId") || "").trim();

  await adminFetch("/admin/settings/chatwoot", {
    method: "PUT",
    body: JSON.stringify({
      baseUrl,
      apiAccessToken,
      ...(accountId ? { accountId: Number(accountId) } : {}),
      ...(inboxId ? { inboxId: Number(inboxId) } : {})
    })
  });
  redirect("/settings?saved=1");
}

