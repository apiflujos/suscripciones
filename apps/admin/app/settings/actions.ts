"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function redirectWith(action: string, status: "ok" | "fail", error?: string) {
  const qp = new URLSearchParams({ a: action, status });
  if (error) qp.set("error", error);
  redirect(`/settings?${qp.toString()}`);
}

function normalizeUrl(input: string) {
  const v = String(input || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

async function adminFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, "x-admin-token": TOKEN } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.reason ? `${json?.error || "request_failed"}:${json.reason}` : json?.message || json?.error || `request_failed_${res.status}`);
  return json;
}

export async function updateWompi(formData: FormData) {
  const environment = String(formData.get("environment") || "").trim();
  const publicKey = String(formData.get("publicKey") || "").trim();
  const privateKey = String(formData.get("privateKey") || "").trim();
  const integritySecret = String(formData.get("integritySecret") || "").trim();
  const eventsSecret = String(formData.get("eventsSecret") || "").trim();
  const apiBaseUrl = String(formData.get("apiBaseUrl") || "").trim();
  const checkoutLinkBaseUrl = String(formData.get("checkoutLinkBaseUrl") || "").trim();
  const redirectUrl = String(formData.get("redirectUrl") || "").trim();

  try {
    await adminFetch("/admin/settings/wompi", {
      method: "PUT",
      body: JSON.stringify({
        ...(environment ? { environment } : {}),
        ...(publicKey ? { publicKey } : {}),
        ...(privateKey ? { privateKey } : {}),
        ...(integritySecret ? { integritySecret } : {}),
        ...(eventsSecret ? { eventsSecret } : {}),
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
        ...(checkoutLinkBaseUrl ? { checkoutLinkBaseUrl } : {}),
        ...(redirectUrl != null ? { redirectUrl } : {})
      })
    });
    redirectWith("wompi_creds", "ok");
  } catch (err) {
    redirectWith("wompi_creds", "fail", toShortErrorMessage(err));
  }
}

export async function updateShopify(formData: FormData) {
  const forwardUrl = String(formData.get("forwardUrl") || "").trim();
  const forwardSecret = String(formData.get("forwardSecret") || "").trim();

  try {
    await adminFetch("/admin/settings/shopify", {
      method: "PUT",
      body: JSON.stringify({ forwardUrl, forwardSecret })
    });
    redirectWith("shopify_save", "ok");
  } catch (err) {
    redirectWith("shopify_save", "fail", toShortErrorMessage(err));
  }
}

export async function testShopifyForward(formData: FormData) {
  const forwardUrl = String(formData.get("forwardUrl") || "").trim();
  const forwardSecret = String(formData.get("forwardSecret") || "").trim();
  try {
    await adminFetch("/admin/settings/shopify/test-forward", {
      method: "POST",
      body: JSON.stringify({ forwardUrl, forwardSecret })
    });
    redirectWith("shopify_test", "ok");
  } catch (err) {
    redirectWith("shopify_test", "fail", toShortErrorMessage(err));
  }
}

export async function updateChatwoot(formData: FormData) {
  const environment = String(formData.get("environment") || "").trim();
  const baseUrl = normalizeUrl(String(formData.get("baseUrl") || ""));
  const accountId = String(formData.get("accountId") || "").trim();
  const apiAccessToken = String(formData.get("apiAccessToken") || "").trim();
  const inboxId = String(formData.get("inboxId") || "").trim();

  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "PUT",
      body: JSON.stringify({
        ...(environment ? { environment } : {}),
        baseUrl,
        apiAccessToken,
        ...(accountId ? { accountId: Number(accountId) } : {}),
        ...(inboxId ? { inboxId: Number(inboxId) } : {})
      })
    });
    redirectWith("central_save", "ok");
  } catch (err) {
    redirectWith("central_save", "fail", toShortErrorMessage(err));
  }
}

export async function setWompiActiveEnv(formData: FormData) {
  const activeEnv = String(formData.get("activeEnv") || "").trim().toUpperCase();
  try {
    await adminFetch("/admin/settings/wompi", {
      method: "PUT",
      body: JSON.stringify({ activeEnv })
    });
    redirectWith("wompi_env", "ok");
  } catch (err) {
    redirectWith("wompi_env", "fail", toShortErrorMessage(err));
  }
}

export async function setCentralActiveEnv(formData: FormData) {
  const activeEnv = String(formData.get("activeEnv") || "").trim().toUpperCase();
  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "PUT",
      body: JSON.stringify({ activeEnv })
    });
    redirectWith("central_env", "ok");
  } catch (err) {
    redirectWith("central_env", "fail", toShortErrorMessage(err));
  }
}

export async function bootstrapCentralAttributes() {
  try {
    await adminFetch("/admin/comms/bootstrap-attributes", { method: "POST" });
    redirectWith("central_bootstrap", "ok");
  } catch (err) {
    redirectWith("central_bootstrap", "fail", toShortErrorMessage(err));
  }
}

export async function syncCentralAttributes(formData: FormData) {
  const limit = String(formData.get("limit") || "").trim();
  const qp = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  try {
    await adminFetch(`/admin/comms/sync-attributes${qp}`, { method: "POST" });
    redirectWith("central_sync", "ok");
  } catch (err) {
    redirectWith("central_sync", "fail", toShortErrorMessage(err));
  }
}

export async function testCentralConnection(formData: FormData) {
  const baseUrl = normalizeUrl(String(formData.get("baseUrl") || ""));
  const accountId = String(formData.get("accountId") || "").trim();
  const inboxId = String(formData.get("inboxId") || "").trim();
  const apiAccessToken = String(formData.get("apiAccessToken") || "").trim();

  try {
    await adminFetch("/admin/comms/test-connection", {
      method: "POST",
      body: JSON.stringify({
        baseUrl,
        apiAccessToken,
        accountId: Number(accountId),
        inboxId: Number(inboxId)
      })
    });
    redirectWith("central_test", "ok");
  } catch (err) {
    redirectWith("central_test", "fail", toShortErrorMessage(err));
  }
}
