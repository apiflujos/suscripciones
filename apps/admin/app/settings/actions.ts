"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { getRequiredApiBase } from "../lib/adminApi";
import { assertCsrfToken } from "../lib/csrf";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  return raw.startsWith("/settings") ? raw : "/settings";
}

function redirectWith(action: string, status: "ok" | "fail", error: string | undefined, returnTo: string) {
  const qp = new URLSearchParams({ a: action, status });
  if (error) qp.set("error", error);
  const base = returnTo || "/settings";
  const url = new URL(base, "http://localhost");
  qp.forEach((v, k) => url.searchParams.set(k, v));
  redirect(`${url.pathname}?${url.searchParams.toString()}`);
}

function normalizeUrl(input: string) {
  const v = String(input || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

async function adminFetch(path: string, init: RequestInit) {
  const API_BASE = getRequiredApiBase();
  const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");
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
  const returnTo = safeReturnTo(formData);
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
    redirectWith("wompi_creds", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_creds", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function testWompiConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
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
    redirectWith("wompi_test", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_test", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function deleteWompiConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const environment = String(formData.get("environment") || "").trim();

  try {
    await adminFetch("/admin/settings/wompi", {
      method: "DELETE",
      body: JSON.stringify({ environment: environment || "PRODUCTION" })
    });
    redirectWith("wompi_delete", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_delete", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateShopify(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
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
    redirectWith("shopify_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("shopify_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function deleteShopifyConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  try {
    await adminFetch("/admin/settings/shopify", { method: "DELETE" });
    redirectWith("shopify_delete", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("shopify_delete", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function testShopifyForward(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
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
    redirectWith("shopify_test", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("shopify_test", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateChatwoot(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const environment = String(formData.get("environment") || "").trim();
  const baseUrlRaw = String(formData.get("baseUrl") || "").trim();
  const baseUrl = baseUrlRaw ? normalizeUrl(baseUrlRaw) : "";
  const accountId = String(formData.get("accountId") || "").trim();
  const apiAccessToken = String(formData.get("apiAccessToken") || "").trim();
  const inboxId = String(formData.get("inboxId") || "").trim();
  const productTemplateName = String(formData.get("productTemplateName") || "").trim();
  const productTemplateLang = String(formData.get("productTemplateLang") || "").trim();

  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "PUT",
      body: JSON.stringify({
        ...(environment ? { environment } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiAccessToken ? { apiAccessToken } : {}),
        ...(accountId ? { accountId: Number(accountId) } : {}),
        ...(inboxId ? { inboxId: Number(inboxId) } : {}),
        ...(productTemplateName ? { productTemplateName } : {}),
        ...(productTemplateLang ? { productTemplateLang } : {})
      })
    });
    redirectWith("central_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateGamificationConfig(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const followupMinutes = Number(formData.get("followupMinutes") || 15);
  const followupCooldown = Number(formData.get("followupCooldown") || 120);
  const followupMaxAttempts = Number(formData.get("followupMaxAttempts") || 3);
  const followupPenalty = Number(formData.get("followupPenalty") || 25);
  const decayDays = Number(formData.get("decayDays") || 30);
  const decayPerDay = Number(formData.get("decayPerDay") || 2);
  const decayMaxPenalty = Number(formData.get("decayMaxPenalty") || 180);
  const weightPaymentApprovedStatus = Number(formData.get("weightPaymentApprovedStatus"));
  const weightPaymentApprovedLifetime = Number(formData.get("weightPaymentApprovedLifetime"));
  const weightPaymentApprovedReward = Number(formData.get("weightPaymentApprovedReward"));
  const weightPaymentApprovedMoneyScale = Number(formData.get("weightPaymentApprovedMoneyScale"));
  const weightPaymentFailedStatus = Number(formData.get("weightPaymentFailedStatus"));
  const weightSubStartStatus = Number(formData.get("weightSubStartStatus"));
  const weightSubStartLifetime = Number(formData.get("weightSubStartLifetime"));
  const weightSubStartReward = Number(formData.get("weightSubStartReward"));
  const weightSubRenewStatus = Number(formData.get("weightSubRenewStatus"));
  const weightSubRenewLifetime = Number(formData.get("weightSubRenewLifetime"));
  const weightSubRenewReward = Number(formData.get("weightSubRenewReward"));
  const weightSubCancelStatus = Number(formData.get("weightSubCancelStatus"));
  const weightSubPastStatus = Number(formData.get("weightSubPastStatus"));
  const weightChatwootStatus = Number(formData.get("weightChatwootStatus"));
  const weightChatwootLifetime = Number(formData.get("weightChatwootLifetime"));
  const weightChatwootReward = Number(formData.get("weightChatwootReward"));
  const weightEmailStatus = Number(formData.get("weightEmailStatus"));
  const weightPhoneStatus = Number(formData.get("weightPhoneStatus"));
  const weightIdStatus = Number(formData.get("weightIdStatus"));
  const penaltyPastDue = Number(formData.get("penaltyPastDue"));
  const penaltyCanceled = Number(formData.get("penaltyCanceled"));

  try {
    await adminFetch("/admin/gamification/config", {
      method: "PUT",
      body: JSON.stringify({
        config: {
          version: 1,
          followup: {
            minutes: Number.isFinite(followupMinutes) ? Math.max(1, Math.trunc(followupMinutes)) : 15,
            cooldownMinutes: Number.isFinite(followupCooldown) ? Math.max(1, Math.trunc(followupCooldown)) : 120,
            maxAttempts: Number.isFinite(followupMaxAttempts) ? Math.max(1, Math.trunc(followupMaxAttempts)) : 3,
            penaltyNoResponse: Number.isFinite(followupPenalty) ? Math.max(0, Math.trunc(followupPenalty)) : 25
          },
          decay: {
            inactivityDays: Number.isFinite(decayDays) ? Math.max(1, Math.trunc(decayDays)) : 30,
            perDay: Number.isFinite(decayPerDay) ? Math.max(0, Math.trunc(decayPerDay)) : 2,
            maxPenalty: Number.isFinite(decayMaxPenalty) ? Math.max(0, Math.trunc(decayMaxPenalty)) : 180
          },
          weights: {
            paymentApproved: {
              status: Number.isFinite(weightPaymentApprovedStatus) ? Math.trunc(weightPaymentApprovedStatus) : 120,
              lifetime: Number.isFinite(weightPaymentApprovedLifetime) ? Math.trunc(weightPaymentApprovedLifetime) : 100,
              reward: Number.isFinite(weightPaymentApprovedReward) ? Math.trunc(weightPaymentApprovedReward) : 40,
              moneyScale: Number.isFinite(weightPaymentApprovedMoneyScale) ? Math.max(1, Math.trunc(weightPaymentApprovedMoneyScale)) : 10000
            },
            paymentFailed: {
              status: Number.isFinite(weightPaymentFailedStatus) ? Math.trunc(weightPaymentFailedStatus) : -60,
              lifetime: 0,
              reward: 0
            },
            subscriptionStarted: {
              status: Number.isFinite(weightSubStartStatus) ? Math.trunc(weightSubStartStatus) : 60,
              lifetime: Number.isFinite(weightSubStartLifetime) ? Math.trunc(weightSubStartLifetime) : 40,
              reward: Number.isFinite(weightSubStartReward) ? Math.trunc(weightSubStartReward) : 10
            },
            subscriptionRenewed: {
              status: Number.isFinite(weightSubRenewStatus) ? Math.trunc(weightSubRenewStatus) : 70,
              lifetime: Number.isFinite(weightSubRenewLifetime) ? Math.trunc(weightSubRenewLifetime) : 50,
              reward: Number.isFinite(weightSubRenewReward) ? Math.trunc(weightSubRenewReward) : 15
            },
            subscriptionCanceled: {
              status: Number.isFinite(weightSubCancelStatus) ? Math.trunc(weightSubCancelStatus) : -120,
              lifetime: 0,
              reward: 0
            },
            subscriptionPastDue: {
              status: Number.isFinite(weightSubPastStatus) ? Math.trunc(weightSubPastStatus) : -80,
              lifetime: 0,
              reward: 0
            },
            chatwootMessageIn: {
              status: Number.isFinite(weightChatwootStatus) ? Math.trunc(weightChatwootStatus) : 12,
              lifetime: Number.isFinite(weightChatwootLifetime) ? Math.trunc(weightChatwootLifetime) : 6,
              reward: Number.isFinite(weightChatwootReward) ? Math.trunc(weightChatwootReward) : 2
            },
            dataEmailAdded: {
              status: Number.isFinite(weightEmailStatus) ? Math.trunc(weightEmailStatus) : 10,
              lifetime: 10,
              reward: 0
            },
            dataPhoneAdded: {
              status: Number.isFinite(weightPhoneStatus) ? Math.trunc(weightPhoneStatus) : 10,
              lifetime: 10,
              reward: 0
            },
            dataIdAdded: {
              status: Number.isFinite(weightIdStatus) ? Math.trunc(weightIdStatus) : 15,
              lifetime: 15,
              reward: 0
            }
          },
          penalties: {
            pastDue: Number.isFinite(penaltyPastDue) ? Math.max(0, Math.trunc(penaltyPastDue)) : 90,
            canceled: Number.isFinite(penaltyCanceled) ? Math.max(0, Math.trunc(penaltyCanceled)) : 120
          }
        }
      })
    });
    redirectWith("gamification_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("gamification_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateAiProvider(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const provider = String(formData.get("provider") || "").trim().toUpperCase();
  const apiKey = String(formData.get("apiKey") || "").trim();

  if (!provider) {
    redirectWith("ai_save", "fail", "provider_required", returnTo);
    return;
  }

  try {
    await adminFetch("/admin/settings/ai", {
      method: "PUT",
      body: JSON.stringify({
        provider,
        ...(apiKey ? { apiKey } : {})
      })
    });
    redirectWith("ai_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("ai_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function deleteAiProvider(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const provider = String(formData.get("provider") || "").trim().toUpperCase();

  try {
    await adminFetch("/admin/settings/ai", {
      method: "DELETE",
      body: JSON.stringify({ provider })
    });
    redirectWith("ai_delete", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("ai_delete", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateCheckoutConfig(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
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
  setString("defaultUtmParams");
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
    redirectWith("checkout_config", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_config", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function setWompiActiveEnv(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const activeEnv = String(formData.get("activeEnv") || "").trim().toUpperCase();
  try {
    await adminFetch("/admin/settings/wompi", {
      method: "PUT",
      body: JSON.stringify({ activeEnv })
    });
    redirectWith("wompi_env", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("wompi_env", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function setCentralActiveEnv(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const activeEnv = String(formData.get("activeEnv") || "").trim().toUpperCase();
  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "PUT",
      body: JSON.stringify({ activeEnv })
    });
    redirectWith("central_env", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_env", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function bootstrapCentralAttributes(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  try {
    await adminFetch("/admin/comms/bootstrap-attributes", { method: "POST" });
    redirectWith("central_bootstrap", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_bootstrap", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function syncCentralAttributes(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const limit = String(formData.get("limit") || "").trim();
  const qp = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  try {
    await adminFetch(`/admin/comms/sync-attributes${qp}`, { method: "POST" });
    redirectWith("central_sync", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_sync", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function testCentralConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
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
    redirectWith("central_test", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_test", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function deleteCentralConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const environment = String(formData.get("environment") || "").trim();
  try {
    await adminFetch("/admin/settings/chatwoot", {
      method: "DELETE",
      body: JSON.stringify({ environment: environment || "PRODUCTION" })
    });
    redirectWith("central_delete", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_delete", "fail", toShortErrorMessage(err), returnTo);
  }
}
