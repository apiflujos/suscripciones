"use server";

import { redirect } from "next/navigation";
import { CredentialProvider } from "@prisma/client";
import { getCredential } from "@suscripciones/core/services/credentials";
import { assertCsrfToken } from "../lib/csrf";
import {
  deleteAiProvider as deleteAiProviderAction,
  deleteChatwootSettings,
  deleteShopifySettings,
  deleteWompiSettings,
  testShopifyForward as testShopifyForwardAction,
  testWompiConnection as testWompiConnectionAction,
  updateAiProvider as updateAiProviderAction,
  updateAutoDebitConfig as updateAutoDebitConfigAction,
  updateChatwootSettings,
  updateCheckoutConfig as updateCheckoutConfigAction,
  updatePaymentsConfig as updatePaymentsConfigAction,
  updateShopifySettings,
  updateWompiSettings
} from "../admin/_services/settingsActions";
import { getCheckoutConfig } from "../admin/_services/settings";
import { bootstrapChatwootAttributes, syncContactsAttributes, testChatwootConnection } from "../admin/_services/comms";
import { updateGamificationConfig as updateGamificationConfigAction } from "../admin/_services/gamification";
import { createWebhookEndpoint, deleteWebhookEndpoint, updateWebhookEndpoint } from "../admin/_services/webhookEndpoints";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { cookies } from "next/headers";
import { createApiToken, revokeApiToken } from "../admin/_services/apiTokens";

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

async function requireTenantId() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  const tenantId = String(session?.tenantId || "").trim();
  if (!tenantId) throw new Error("tenant_required");
  return tenantId;
}

function normalizeUrl(input: string) {
  const v = String(input || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function assertOk(result: { ok: boolean; error?: string; message?: string; status?: number; details?: any }) {
  if (result.ok) return;
  const err = result.error || result.message || `request_failed_${result.status || 400}`;
  throw new Error(err);
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
    const out = await updateWompiSettings({
      ...(environment ? { environment } : {}),
      ...(publicKey ? { publicKey } : {}),
      ...(privateKey ? { privateKey } : {}),
      ...(integritySecret ? { integritySecret } : {}),
      ...(eventsSecret ? { eventsSecret } : {}),
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      ...(checkoutLinkBaseUrl ? { checkoutLinkBaseUrl } : {}),
      ...(redirectUrl != null ? { redirectUrl } : {})
    });
    assertOk(out as any);
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
  const redirectOnFinish = String(formData.get("redirectOnFinish") || "") === "1";

  try {
    const out = await testWompiConnectionAction({
      ...(environment ? { environment } : {}),
      ...(publicKey ? { publicKey } : {}),
      ...(apiBaseUrl ? { apiBaseUrl } : {})
    });
    assertOk(out as any);
    if (redirectOnFinish) {
      redirectWith("wompi_test", "ok", undefined, returnTo);
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    if (redirectOnFinish) {
      redirectWith("wompi_test", "fail", toShortErrorMessage(err), returnTo);
    }
    throw new Error(toShortErrorMessage(err));
  }
}

export async function deleteWompiConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const environment = String(formData.get("environment") || "").trim();

  try {
    const out = await deleteWompiSettings({ environment: environment || "PRODUCTION" });
    assertOk(out as any);
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
    const out = await updateShopifySettings({
      ...(forwardUrl ? { forwardUrl } : {}),
      ...(forwardSecret ? { forwardSecret } : {}),
      ...(forwardOrigin ? { forwardOrigin } : {}),
      ...(forwardRetryEnabled ? { forwardRetryEnabled } : {}),
      ...(forwardRetryMinutes ? { forwardRetryMinutes } : {})
    });
    assertOk(out as any);
    redirectWith("shopify_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("shopify_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateAutoDebitConfig(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const enabled = getLastValue(formData, "enabled");
  const chargeAtCutoffEnabled = getLastValue(formData, "chargeAtCutoffEnabled");
  const allowManualCharge = getLastValue(formData, "allowManualCharge");
  const retryEnabled = getLastValue(formData, "retryEnabled");
  const retryEveryValue = String(formData.get("retryEveryValue") || "").trim();
  const retryEveryUnit = String(formData.get("retryEveryUnit") || "").trim().toUpperCase();
  const retryEveryMinutes = String(formData.get("retryEveryMinutes") || "").trim();
  const maxRetries = String(formData.get("maxRetries") || "").trim();
  const retryEveryValueNumber = Number.parseInt(retryEveryValue, 10);
  const retryEveryUnitNormalized = retryEveryUnit || "MINUTES";
  const computedRetryMinutes = Number.isFinite(retryEveryValueNumber) && retryEveryValueNumber > 0
    ? (() => {
        switch (retryEveryUnitNormalized) {
          case "SECONDS":
            return Math.max(1, Math.ceil(retryEveryValueNumber / 60));
          case "HOURS":
            return retryEveryValueNumber * 60;
          case "DAYS":
            return retryEveryValueNumber * 60 * 24;
          case "MINUTES":
          default:
            return retryEveryValueNumber;
        }
      })()
    : null;

  try {
    const out = await updateAutoDebitConfigAction({
      ...(enabled ? { enabled } : {}),
      ...(chargeAtCutoffEnabled ? { chargeAtCutoffEnabled } : {}),
      ...(allowManualCharge ? { allowManualCharge } : {}),
      ...(retryEnabled ? { retryEnabled } : {}),
      ...(retryEveryValue ? { retryEveryValue } : {}),
      ...(retryEveryUnit ? { retryEveryUnit: retryEveryUnitNormalized } : {}),
      ...(computedRetryMinutes ? { retryEveryMinutes: String(computedRetryMinutes) } : retryEveryMinutes ? { retryEveryMinutes } : {}),
      ...(maxRetries ? { maxRetries } : {})
    });
    assertOk(out as any);
    redirectWith("auto_debit_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("auto_debit_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updatePaymentsConfig(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const autoReconcileUnlinkedPayments = getLastValue(formData, "autoReconcileUnlinkedPayments");
  const acceptUnlinkedPayments = getLastValue(formData, "acceptUnlinkedPayments");
  const notifyWhatsappForUnlinkedPayments = getLastValue(formData, "notifyWhatsappForUnlinkedPayments");
  const includeUnlinkedPaymentsInMetrics = getLastValue(formData, "includeUnlinkedPaymentsInMetrics");
  const defaultCycleStartDay = String(formData.get("defaultCycleStartDay") || "").trim();
  const defaultPaymentDay = String(formData.get("defaultPaymentDay") || "").trim();
  const defaultPaymentTiming = String(formData.get("defaultPaymentTiming") || "").trim();
  const defaultGraceDays = String(formData.get("defaultGraceDays") || "").trim();

  try {
    const out = await updatePaymentsConfigAction({
      ...(autoReconcileUnlinkedPayments ? { autoReconcileUnlinkedPayments } : {}),
      ...(acceptUnlinkedPayments ? { acceptUnlinkedPayments } : {}),
      ...(notifyWhatsappForUnlinkedPayments ? { notifyWhatsappForUnlinkedPayments } : {}),
      ...(includeUnlinkedPaymentsInMetrics ? { includeUnlinkedPaymentsInMetrics } : {}),
      ...(defaultCycleStartDay ? { defaultCycleStartDay } : {}),
      ...(defaultPaymentDay ? { defaultPaymentDay } : {}),
      ...(defaultPaymentTiming ? { defaultPaymentTiming } : {}),
      ...(defaultGraceDays ? { defaultGraceDays } : {})
    });
    assertOk(out as any);
    redirectWith("payments_config_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("payments_config_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function createWebhookEndpointAction(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const name = String(formData.get("name") || "").trim();
  const provider = String(formData.get("provider") || "").trim();
  const secret = String(formData.get("secret") || "").trim();
  const active = getLastValue(formData, "active");
  try {
    const tenantId = await requireTenantId();
    await createWebhookEndpoint({ tenantId, name, provider, secret, active });
    redirectWith("webhook_create", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("webhook_create", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateWebhookEndpointAction(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const provider = String(formData.get("provider") || "").trim();
  const secret = String(formData.get("secret") || "").trim();
  const active = getLastValue(formData, "active");
  try {
    const tenantId = await requireTenantId();
    await updateWebhookEndpoint({
      tenantId,
      id,
      ...(name ? { name } : {}),
      ...(provider ? { provider } : {}),
      ...(active ? { active } : {}),
      ...(secret ? { secret } : {})
    });
    redirectWith("webhook_update", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("webhook_update", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function deleteWebhookEndpointAction(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  try {
    const tenantId = await requireTenantId();
    await deleteWebhookEndpoint({ tenantId, id });
    redirectWith("webhook_delete", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("webhook_delete", "fail", toShortErrorMessage(err), returnTo);
  }
}

function getLastValue(formData: FormData, name: string) {
  const values = formData.getAll(name);
  if (!values.length) return "";
  const last = values[values.length - 1];
  return String(last ?? "").trim();
}

export async function createApiTokenAction(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const name = String(formData.get("name") || "").trim();
  const scope = String(formData.get("scope") || "").trim().toLowerCase();
  const ttlHoursRaw = Number(String(formData.get("ttlHours") || "").trim() || "0");
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : 24 * 365 * 10;
  try {
    const tenantId = await requireTenantId();
    const out = await createApiToken({
      tenantId,
      name,
      scope: scope === "read" ? "read" : "write",
      ttlHours
    });
    const qp = new URLSearchParams({ a: "api_token_create", status: "ok", token: out.token });
    const url = new URL(returnTo || "/settings", "http://localhost");
    qp.forEach((v, k) => url.searchParams.set(k, v));
    redirect(`${url.pathname}?${url.searchParams.toString()}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("api_token_create", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function revokeApiTokenAction(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const id = String(formData.get("id") || "").trim();
  try {
    const tenantId = await requireTenantId();
    await revokeApiToken({ tenantId, id });
    redirectWith("api_token_revoke", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("api_token_revoke", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function deleteShopifyConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  try {
    const out = await deleteShopifySettings();
    assertOk(out as any);
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
    const out = await testShopifyForwardAction({
      ...(forwardUrl ? { forwardUrl } : {}),
      ...(forwardSecret ? { forwardSecret } : {}),
      ...(forwardOrigin ? { forwardOrigin } : {})
    });
    assertOk(out as any);
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

  try {
    const env = environment || "PRODUCTION";
    const existingBaseUrl = (await getCredential(CredentialProvider.CHATWOOT, `BASE_URL_${env}`)) || (await getCredential(CredentialProvider.CHATWOOT, "BASE_URL")) || "";
    const existingAccountId = (await getCredential(CredentialProvider.CHATWOOT, `ACCOUNT_ID_${env}`)) || (await getCredential(CredentialProvider.CHATWOOT, "ACCOUNT_ID")) || "";
    const existingInboxId = (await getCredential(CredentialProvider.CHATWOOT, `INBOX_ID_${env}`)) || (await getCredential(CredentialProvider.CHATWOOT, "INBOX_ID")) || "";
    const existingToken =
      (await getCredential(CredentialProvider.CHATWOOT, `API_ACCESS_TOKEN_${env}`)) ||
      (await getCredential(CredentialProvider.CHATWOOT, "API_ACCESS_TOKEN")) ||
      "";
    const missing: string[] = [];
    if (!baseUrl && !existingBaseUrl) missing.push("baseUrl");
    if (!accountId && !existingAccountId) missing.push("accountId");
    if (!inboxId && !existingInboxId) missing.push("inboxId");
    if (!apiAccessToken && !existingToken) missing.push("apiAccessToken");
    if (missing.length) {
      throw new Error(`missing_fields:${missing.join(",")}`);
    }

    const out = await updateChatwootSettings({
      ...(environment ? { environment } : {}),
      ...(environment ? { activeEnv: environment } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiAccessToken ? { apiAccessToken } : {}),
      ...(accountId ? { accountId: Number(accountId) } : {}),
      ...(inboxId ? { inboxId: Number(inboxId) } : {})
    });
    assertOk(out as any);
    redirectWith("central_save", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_save", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateGamificationConfig(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const preset = String(formData.get("preset") || "").trim().toLowerCase();
  const applyPreset = String(formData.get("applyPreset") || "") === "1";
  const resetDefaults = String(formData.get("resetDefaults") || "") === "1";

  const baseConfig = {
    version: 1,
    followup: {
      minutes: 15,
      cooldownMinutes: 120,
      maxAttempts: 3,
      penaltyNoResponse: 25
    },
    decay: {
      inactivityDays: 30,
      perDay: 2,
      maxPenalty: 180
    },
    weights: {
      paymentApproved: { status: 120, lifetime: 100, reward: 40, moneyScale: 10000 },
      paymentFailed: { status: -60, lifetime: 0, reward: 0 },
      subscriptionStarted: { status: 60, lifetime: 40, reward: 10 },
      subscriptionRenewed: { status: 70, lifetime: 50, reward: 15 },
      subscriptionCanceled: { status: -120, lifetime: 0, reward: 0 },
      subscriptionPastDue: { status: -80, lifetime: 0, reward: 0 },
      chatwootMessageIn: { status: 12, lifetime: 6, reward: 2 },
      dataEmailAdded: { status: 10, lifetime: 10, reward: 0 },
      dataPhoneAdded: { status: 10, lifetime: 10, reward: 0 },
      dataIdAdded: { status: 15, lifetime: 15, reward: 0 }
    },
    penalties: {
      pastDue: 90,
      canceled: 120
    }
  };

  function buildPresetConfig(key: string) {
    if (key === "conservative") {
      return {
        ...baseConfig,
        weights: {
          ...baseConfig.weights,
          paymentApproved: { status: 100, lifetime: 80, reward: 30, moneyScale: 12000 },
          paymentFailed: { status: -70, lifetime: 0, reward: 0 },
          subscriptionStarted: { status: 50, lifetime: 30, reward: 8 },
          subscriptionRenewed: { status: 55, lifetime: 40, reward: 10 },
          subscriptionCanceled: { status: -140, lifetime: 0, reward: 0 },
          subscriptionPastDue: { status: -95, lifetime: 0, reward: 0 },
          chatwootMessageIn: { status: 8, lifetime: 4, reward: 2 },
          dataEmailAdded: { status: 8, lifetime: 8, reward: 0 },
          dataPhoneAdded: { status: 8, lifetime: 8, reward: 0 },
          dataIdAdded: { status: 12, lifetime: 12, reward: 0 }
        },
        penalties: {
          pastDue: 110,
          canceled: 140
        }
      };
    }
    if (key === "aggressive") {
      return {
        ...baseConfig,
        weights: {
          ...baseConfig.weights,
          paymentApproved: { status: 150, lifetime: 130, reward: 60, moneyScale: 8000 },
          paymentFailed: { status: -50, lifetime: 0, reward: 0 },
          subscriptionStarted: { status: 80, lifetime: 60, reward: 15 },
          subscriptionRenewed: { status: 90, lifetime: 70, reward: 20 },
          subscriptionCanceled: { status: -90, lifetime: 0, reward: 0 },
          subscriptionPastDue: { status: -60, lifetime: 0, reward: 0 },
          chatwootMessageIn: { status: 16, lifetime: 10, reward: 4 },
          dataEmailAdded: { status: 14, lifetime: 14, reward: 0 },
          dataPhoneAdded: { status: 14, lifetime: 14, reward: 0 },
          dataIdAdded: { status: 20, lifetime: 20, reward: 0 }
        },
        penalties: {
          pastDue: 70,
          canceled: 90
        }
      };
    }
    return baseConfig;
  }
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
    const usePreset = resetDefaults || (applyPreset && preset);
    const config = usePreset
      ? buildPresetConfig(resetDefaults ? "balanced" : preset)
      : {
          ...baseConfig,
          followup: {
            minutes: Number.isFinite(followupMinutes) ? Math.max(1, Math.trunc(followupMinutes)) : baseConfig.followup.minutes,
            cooldownMinutes: Number.isFinite(followupCooldown) ? Math.max(1, Math.trunc(followupCooldown)) : baseConfig.followup.cooldownMinutes,
            maxAttempts: Number.isFinite(followupMaxAttempts) ? Math.max(1, Math.trunc(followupMaxAttempts)) : baseConfig.followup.maxAttempts,
            penaltyNoResponse: Number.isFinite(followupPenalty) ? Math.max(0, Math.trunc(followupPenalty)) : baseConfig.followup.penaltyNoResponse
          },
          decay: {
            inactivityDays: Number.isFinite(decayDays) ? Math.max(1, Math.trunc(decayDays)) : baseConfig.decay.inactivityDays,
            perDay: Number.isFinite(decayPerDay) ? Math.max(0, Math.trunc(decayPerDay)) : baseConfig.decay.perDay,
            maxPenalty: Number.isFinite(decayMaxPenalty) ? Math.max(0, Math.trunc(decayMaxPenalty)) : baseConfig.decay.maxPenalty
          },
          weights: {
            paymentApproved: {
              status: Number.isFinite(weightPaymentApprovedStatus) ? Math.trunc(weightPaymentApprovedStatus) : baseConfig.weights.paymentApproved.status,
              lifetime: Number.isFinite(weightPaymentApprovedLifetime) ? Math.trunc(weightPaymentApprovedLifetime) : baseConfig.weights.paymentApproved.lifetime,
              reward: Number.isFinite(weightPaymentApprovedReward) ? Math.trunc(weightPaymentApprovedReward) : baseConfig.weights.paymentApproved.reward,
              moneyScale: Number.isFinite(weightPaymentApprovedMoneyScale)
                ? Math.max(1, Math.trunc(weightPaymentApprovedMoneyScale))
                : baseConfig.weights.paymentApproved.moneyScale
            },
            paymentFailed: {
              status: Number.isFinite(weightPaymentFailedStatus) ? Math.trunc(weightPaymentFailedStatus) : baseConfig.weights.paymentFailed.status,
              lifetime: 0,
              reward: 0
            },
            subscriptionStarted: {
              status: Number.isFinite(weightSubStartStatus) ? Math.trunc(weightSubStartStatus) : baseConfig.weights.subscriptionStarted.status,
              lifetime: Number.isFinite(weightSubStartLifetime) ? Math.trunc(weightSubStartLifetime) : baseConfig.weights.subscriptionStarted.lifetime,
              reward: Number.isFinite(weightSubStartReward) ? Math.trunc(weightSubStartReward) : baseConfig.weights.subscriptionStarted.reward
            },
            subscriptionRenewed: {
              status: Number.isFinite(weightSubRenewStatus) ? Math.trunc(weightSubRenewStatus) : baseConfig.weights.subscriptionRenewed.status,
              lifetime: Number.isFinite(weightSubRenewLifetime) ? Math.trunc(weightSubRenewLifetime) : baseConfig.weights.subscriptionRenewed.lifetime,
              reward: Number.isFinite(weightSubRenewReward) ? Math.trunc(weightSubRenewReward) : baseConfig.weights.subscriptionRenewed.reward
            },
            subscriptionCanceled: {
              status: Number.isFinite(weightSubCancelStatus) ? Math.trunc(weightSubCancelStatus) : baseConfig.weights.subscriptionCanceled.status,
              lifetime: 0,
              reward: 0
            },
            subscriptionPastDue: {
              status: Number.isFinite(weightSubPastStatus) ? Math.trunc(weightSubPastStatus) : baseConfig.weights.subscriptionPastDue.status,
              lifetime: 0,
              reward: 0
            },
            chatwootMessageIn: {
              status: Number.isFinite(weightChatwootStatus) ? Math.trunc(weightChatwootStatus) : baseConfig.weights.chatwootMessageIn.status,
              lifetime: Number.isFinite(weightChatwootLifetime) ? Math.trunc(weightChatwootLifetime) : baseConfig.weights.chatwootMessageIn.lifetime,
              reward: Number.isFinite(weightChatwootReward) ? Math.trunc(weightChatwootReward) : baseConfig.weights.chatwootMessageIn.reward
            },
            dataEmailAdded: {
              status: Number.isFinite(weightEmailStatus) ? Math.trunc(weightEmailStatus) : baseConfig.weights.dataEmailAdded.status,
              lifetime: baseConfig.weights.dataEmailAdded.lifetime,
              reward: 0
            },
            dataPhoneAdded: {
              status: Number.isFinite(weightPhoneStatus) ? Math.trunc(weightPhoneStatus) : baseConfig.weights.dataPhoneAdded.status,
              lifetime: baseConfig.weights.dataPhoneAdded.lifetime,
              reward: 0
            },
            dataIdAdded: {
              status: Number.isFinite(weightIdStatus) ? Math.trunc(weightIdStatus) : baseConfig.weights.dataIdAdded.status,
              lifetime: baseConfig.weights.dataIdAdded.lifetime,
              reward: 0
            }
          },
          penalties: {
            pastDue: Number.isFinite(penaltyPastDue) ? Math.max(0, Math.trunc(penaltyPastDue)) : baseConfig.penalties.pastDue,
            canceled: Number.isFinite(penaltyCanceled) ? Math.max(0, Math.trunc(penaltyCanceled)) : baseConfig.penalties.canceled
          }
        };

    const out = await updateGamificationConfigAction(config);
    assertOk(out as any);
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
    const out = await updateAiProviderAction({
      provider,
      ...(apiKey ? { apiKey } : {})
    });
    assertOk(out as any);
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
    const out = await deleteAiProviderAction({ provider });
    assertOk(out as any);
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
  setString("cartBaseUrl");
  setString("defaultUtmParams");
  setNumber("tokenExpiryHours");
  setString("defaultPlanTemplateId");
  setString("defaultSubscriptionTemplateId");
  setString("defaultCartTemplateId");
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
  setString("timeZone");

  try {
    const out = await updateCheckoutConfigAction(payload);
    assertOk(out as any);
    redirectWith("checkout_config", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_config", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateCheckoutDefaults(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  try {
    // Leer config actual para no sobreescribir otros campos
    const current = await getCheckoutConfig();
    const merged = {
      ...current,
      defaultPlanTemplateId: String(formData.get("defaultPlanTemplateId") || "").trim(),
      defaultSubscriptionTemplateId: String(formData.get("defaultSubscriptionTemplateId") || "").trim(),
      defaultCartTemplateId: String(formData.get("defaultCartTemplateId") || "").trim(),
    };
    const out = await updateCheckoutConfigAction(merged);
    assertOk(out as any);
    redirectWith("checkout_defaults", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("checkout_defaults", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function setWompiActiveEnv(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const activeEnv = String(formData.get("activeEnv") || "").trim().toUpperCase();
  try {
    const out = await updateWompiSettings({ activeEnv });
    assertOk(out as any);
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
    const out = await updateChatwootSettings({ activeEnv });
    assertOk(out as any);
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
    const out = await bootstrapChatwootAttributes();
    assertOk(out as any);
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
    const limitVal = limit ? Number(limit) : undefined;
    const out = await syncContactsAttributes(Number.isFinite(Number(limitVal)) ? Number(limitVal) : 200);
    assertOk(out as any);
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
  const redirectOnFinish = String(formData.get("redirectOnFinish") || "") === "1";

  try {
    const out = await testChatwootConnection({
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiAccessToken ? { apiAccessToken } : {}),
      ...(accountId ? { accountId: Number(accountId) } : {}),
      ...(inboxId ? { inboxId: Number(inboxId) } : {})
    });
    assertOk(out as any);
    if (redirectOnFinish) {
      redirectWith("central_test", "ok", undefined, returnTo);
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    if (redirectOnFinish) {
      redirectWith("central_test", "fail", toShortErrorMessage(err), returnTo);
    }
    throw new Error(toShortErrorMessage(err));
  }
}

export async function deleteCentralConnection(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const environment = String(formData.get("environment") || "").trim();
  try {
    const out = await deleteChatwootSettings({ environment: environment || "PRODUCTION" });
    assertOk(out as any);
    redirectWith("central_delete", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("central_delete", "fail", toShortErrorMessage(err), returnTo);
  }
}

export async function updateSubscriptionConfig(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeReturnTo(formData);
  const graceDays = Number(formData.get("graceDays") || 5);
  const suspendDays = Number(formData.get("suspendDays") || 15);
  const cancelDays = Number(formData.get("cancelDays") || 30);

  try {
    const res = await updateAutoDebitConfigAction({
      graceDays,
      suspendDays,
      cancelDays
    });
    assertOk(res as any);
    redirectWith("subscription_config", "ok", undefined, returnTo);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("subscription_config", "fail", toShortErrorMessage(err), returnTo);
  }
}
