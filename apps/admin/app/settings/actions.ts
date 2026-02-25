"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { getRequiredApiBase } from "../lib/adminApi";
import { assertCsrfToken } from "../lib/csrf";

const API_BASE = getRequiredApiBase();
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
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
  if (!res.ok) {
    const status = res.status;
    const details =
      json?.error && json?.status && json?.text
        ? `${json.error} (status ${json.status}): ${json.text}`
        : json?.reason
          ? `${json?.error || "request_failed"}:${json.reason}`
          : json?.message || json?.error || `request_failed_${status}`;
    throw new Error(details);
  }
  return json;
}

export async function updateWompi(formData: FormData) {
  await assertCsrfToken(formData);
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
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_creds", "fail", toShortErrorMessage(err));
  }
}

export async function testWompiConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const environment = String(formData.get("environment") || "").trim();
  const publicKey = String(formData.get("publicKey") || "").trim();
  const apiBaseUrl = String(formData.get("apiBaseUrl") || "").trim();

  try {
    await adminFetch("/admin/settings/wompi/test", {
      method: "POST",
      body: JSON.stringify({
        ...(environment ? { environment } : {}),
        ...(publicKey ? { publicKey } : {}),
        ...(apiBaseUrl ? { apiBaseUrl } : {})
      })
    });
    redirectWith("wompi_test", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_test", "fail", toShortErrorMessage(err));
  }
}

export async function deleteWompiConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const environment = String(formData.get("environment") || "").trim();

  try {
    await adminFetch("/admin/settings/wompi", {
      method: "DELETE",
      body: JSON.stringify({ environment: environment || "PRODUCTION" })
    });
    redirectWith("wompi_delete", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_delete", "fail", toShortErrorMessage(err));
  }
}

export async function updateShopify(formData: FormData) {
  await assertCsrfToken(formData);
  const forwardUrl = String(formData.get("forwardUrl") || "").trim();
  const forwardSecret = String(formData.get("forwardSecret") || "").trim();
  const forwardOrigin = String(formData.get("forwardOrigin") || "").trim();
  const forwardRetryEnabled = String(formData.get("forwardRetryEnabled") || "").trim();
  const forwardRetryMinutes = String(formData.get("forwardRetryMinutes") || "").trim();

  try {
    await adminFetch("/admin/settings/shopify", {
      method: "PUT",
      body: JSON.stringify({
        ...(forwardUrl ? { forwardUrl } : {}),
        ...(forwardSecret ? { forwardSecret } : {}),
        ...(forwardOrigin ? { forwardOrigin } : {}),
        ...(forwardRetryEnabled ? { forwardRetryEnabled } : {}),
        ...(forwardRetryMinutes ? { forwardRetryMinutes } : {})
      })
    });
    redirectWith("shopify_save", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("shopify_save", "fail", toShortErrorMessage(err));
  }
}

export async function deleteShopifyConnection(formData: FormData) {
  await assertCsrfToken(formData);
  try {
    await adminFetch("/admin/settings/shopify", { method: "DELETE" });
    redirectWith("shopify_delete", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("shopify_delete", "fail", toShortErrorMessage(err));
  }
}

export async function testShopifyForward(formData: FormData) {
  await assertCsrfToken(formData);
  const forwardUrl = String(formData.get("forwardUrl") || "").trim();
  const forwardSecret = String(formData.get("forwardSecret") || "").trim();
  const forwardOrigin = String(formData.get("forwardOrigin") || "").trim();
  try {
    await adminFetch("/admin/settings/shopify/test-forward", {
      method: "POST",
      body: JSON.stringify({
        ...(forwardUrl ? { forwardUrl } : {}),
        ...(forwardSecret ? { forwardSecret } : {}),
        ...(forwardOrigin ? { forwardOrigin } : {})
      })
    });
    redirectWith("shopify_test", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("shopify_test", "fail", toShortErrorMessage(err));
  }
}

export async function updateChatwoot(formData: FormData) {
  await assertCsrfToken(formData);
  const environment = String(formData.get("environment") || "").trim();
  const baseUrlRaw = String(formData.get("baseUrl") || "").trim();
  const baseUrl = baseUrlRaw ? normalizeUrl(baseUrlRaw) : "";
  const accountId = String(formData.get("accountId") || "").trim();
  const apiAccessToken = String(formData.get("apiAccessToken") || "").trim();
  const inboxId = String(formData.get("inboxId") || "").trim();

  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "PUT",
      body: JSON.stringify({
        ...(environment ? { environment } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiAccessToken ? { apiAccessToken } : {}),
        ...(accountId ? { accountId: Number(accountId) } : {}),
        ...(inboxId ? { inboxId: Number(inboxId) } : {})
      })
    });
    redirectWith("central_save", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_save", "fail", toShortErrorMessage(err));
  }
}

export async function updateCheckoutConfig(formData: FormData) {
  await assertCsrfToken(formData);
  const payload: Record<string, unknown> = {};
  const setString = (key: string) => {
    if (!formData.has(key)) return;
    payload[key] = String(formData.get(key) || "").trim();
  };
  const setNumber = (key: string) => {
    if (!formData.has(key)) return;
    const raw = String(formData.get(key) || "").trim();
    if (raw) payload[key] = Number(raw);
  };

  setString("planBaseUrl");
  setString("subscriptionBaseUrl");
  setNumber("tokenExpiryHours");
  setString("logoUrl");
  setString("supportEmail");
  setString("supportUrl");
  setString("planTitle");
  setString("planDescription");
  setString("subscriptionTitle");
  setString("subscriptionDescription");
  setString("planWompiTitle");
  setString("planWompiDescription");
  setString("subscriptionWompiTitle");
  setString("subscriptionWompiDescription");
  setString("tokenizationSuccessTitle");
  setString("tokenizationSuccessMessage");
  setString("tokenizationErrorMessage");
  setString("tokenizationReturnUrl");

  try {
    await adminFetch("/admin/settings/checkout-config", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    redirectWith("checkout_config", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_config", "fail", toShortErrorMessage(err));
  }
}

export async function setWompiActiveEnv(formData: FormData) {
  await assertCsrfToken(formData);
  const activeEnv = String(formData.get("activeEnv") || "").trim().toUpperCase();
  try {
    await adminFetch("/admin/settings/wompi", {
      method: "PUT",
      body: JSON.stringify({ activeEnv })
    });
    redirectWith("wompi_env", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_env", "fail", toShortErrorMessage(err));
  }
}

export async function setCentralActiveEnv(formData: FormData) {
  await assertCsrfToken(formData);
  const activeEnv = String(formData.get("activeEnv") || "").trim().toUpperCase();
  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "PUT",
      body: JSON.stringify({ activeEnv })
    });
    redirectWith("central_env", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_env", "fail", toShortErrorMessage(err));
  }
}

export async function bootstrapCentralAttributes(formData: FormData) {
  await assertCsrfToken(formData);
  try {
    await adminFetch("/admin/comms/bootstrap-attributes", { method: "POST" });
    redirectWith("central_bootstrap", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_bootstrap", "fail", toShortErrorMessage(err));
  }
}

export async function syncCentralAttributes(formData: FormData) {
  await assertCsrfToken(formData);
  const limit = String(formData.get("limit") || "").trim();
  const qp = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  try {
    await adminFetch(`/admin/comms/sync-attributes${qp}`, { method: "POST" });
    redirectWith("central_sync", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_sync", "fail", toShortErrorMessage(err));
  }
}

export async function testCentralConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const baseUrlRaw = String(formData.get("baseUrl") || "").trim();
  const baseUrl = baseUrlRaw ? normalizeUrl(baseUrlRaw) : "";
  const accountId = String(formData.get("accountId") || "").trim();
  const inboxId = String(formData.get("inboxId") || "").trim();
  const apiAccessToken = String(formData.get("apiAccessToken") || "").trim();

  try {
    await adminFetch("/admin/comms/test-connection", {
      method: "POST",
      body: JSON.stringify({
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiAccessToken ? { apiAccessToken } : {}),
        ...(accountId ? { accountId: Number(accountId) } : {}),
        ...(inboxId ? { inboxId: Number(inboxId) } : {})
      })
    });
    redirectWith("central_test", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_test", "fail", toShortErrorMessage(err));
  }
}

export async function deleteCentralConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const environment = String(formData.get("environment") || "").trim();
  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "DELETE",
      body: JSON.stringify({ environment: environment || "PRODUCTION" })
    });
    redirectWith("central_delete", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_delete", "fail", toShortErrorMessage(err));
  }
}
