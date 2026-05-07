import "server-only";

import { LogLevel, CredentialProvider, RetryJobStatus, RetryJobType } from "@prisma/client";
import { clearCredential, getCredential, setCredential } from "@suscripciones/core/services/credentials";
import { prisma } from "@suscripciones/core/db/prisma";
import {
  buildBillingSeed,
  ensureBillingCyclesForSubscriptions,
  isBillingCyclePaid,
  resolveSubscriptionBillingState
} from "@suscripciones/core/services/billingCycles";
import { checkoutConfigSchema } from "@suscripciones/core/services/checkoutConfig";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { WompiClient } from "@suscripciones/core/providers/wompi/client";
import { getGlobalModuleAccess } from "@suscripciones/core/services/moduleAccess";
import { getAutoDebitConfig, getShopifyForward } from "@suscripciones/core/services/runtimeConfig";
import { postJson } from "@suscripciones/core/lib/http";
import { logger } from "@suscripciones/core/lib/logger";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { ensurePaymentRetryJob } from "@suscripciones/core/services/retryJobScheduler";
import {
  envOnlySchema,
  wompiTestSchema,
  wompiUpdateSchema,
  shopifyUpdateSchema,
  chatwootUpdateSchema,
  autoDebitUpdateSchema,
  paymentsConfigUpdateSchema,
  aiUpdateSchema,
  aiDeleteSchema,
  checkoutConfigUpdateSchema,
  toBool,
  toInt,
  normalizeRetryUnit,
  retryUnitMultiplier,
  deriveRetryUnitAndValue,
  ActiveEnv
} from "../settings/_lib";

type BillingScheduleSubscription = Awaited<ReturnType<typeof loadSubscriptionsForBillingScheduleRefresh>>[number];

async function loadSubscriptionsForBillingScheduleRefresh() {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { notIn: ["CANCELED", "EXPIRED"] as any }
    },
    include: {
      plan: {
        select: {
          metadata: true,
          intervalUnit: true,
          intervalCount: true
        }
      }
    }
  });
  return subscriptions;
}

async function rebuildBillingSchedulesAfterConfigChange(subscriptions: BillingScheduleSubscription[]) {
  for (let index = 0; index < subscriptions.length; index += 100) {
    const chunk = subscriptions.slice(index, index + 100);
    const seeds = await Promise.all(
      chunk.map(async (subscription) => {
        const billingState = await resolveSubscriptionBillingState({ subscriptionId: subscription.id }).catch(() => null);
        const activeCycle = billingState?.activeCycle || null;
        return buildBillingSeed({
          id: subscription.id,
          startAt: subscription.startAt,
          currentCycle: activeCycle?.cycleNumber ?? null,
          currentPeriodStartAt: activeCycle?.periodStartAt ?? null,
          currentPeriodEndAt: activeCycle?.periodEndAt ?? null,
          cycleStartDay: subscription.cycleStartDay,
          paymentDay: subscription.paymentDay,
          paymentTiming: subscription.paymentTiming,
          graceDays: subscription.graceDays,
          plan: {
            intervalUnit: subscription.plan.intervalUnit,
            intervalCount: subscription.plan.intervalCount
          }
        });
      })
    );
    await ensureBillingCyclesForSubscriptions(
      seeds
    );
  }
}

async function cancelPendingOperationalJobsAfterAutoDebitConfigChange() {
  const now = new Date();
  await prisma.retryJob.updateMany({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: RetryJobStatus.PENDING
    },
    data: {
      status: RetryJobStatus.CANCELED,
      lastError: "rescheduled_after_auto_debit_config_change",
      updatedAt: now,
      lockedAt: null,
      lockedBy: null
    }
  });
  await prisma.retryJob.updateMany({
    where: {
      type: RetryJobType.SUBSCRIPTION_REMINDER,
      status: RetryJobStatus.PENDING,
      payload: { path: ["trigger"], equals: "SUBSCRIPTION_DUE" } as any
    },
    data: {
      status: RetryJobStatus.CANCELED,
      lastError: "rescheduled_after_auto_debit_config_change",
      updatedAt: now,
      lockedAt: null,
      lockedBy: null
    }
  });
}

async function rebuildOperationalSchedulesAfterConfigChange(subscriptions: BillingScheduleSubscription[]) {
  const autoDebitConfig = await getAutoDebitConfig().catch(() => null);
  const now = new Date();

  for (const subscription of subscriptions) {
    const billingState = await resolveSubscriptionBillingState({ subscriptionId: subscription.id }).catch(() => null);
    const collectionCycle = billingState?.collectionCycle || null;
    if (collectionCycle && !isBillingCyclePaid(collectionCycle)) {
      await scheduleSubscriptionDueNotifications({
        subscriptionId: subscription.id,
        actor: "settings:auto_debit_config"
      }).catch((err) => {
        logger.warn({ err, subscriptionId: subscription.id }, "Fallo reprogramando notificaciones de vencimiento");
      });
    }

    const collectionMode = resolveSubscriptionCollectionMode(subscription as any);
    if (collectionMode !== "AUTO_DEBIT" && collectionMode !== "AUTO_LINK") continue;
    if (!collectionCycle || isBillingCyclePaid(collectionCycle)) continue;
    if (collectionMode === "AUTO_DEBIT" && (!autoDebitConfig?.enabled || !autoDebitConfig?.chargeAtCutoffEnabled)) continue;

    const runAtBase = new Date(collectionCycle.dueAt || collectionCycle.periodEndAt);
    const runAt = runAtBase.getTime() > now.getTime() ? runAtBase : now;
    await ensurePaymentRetryJob({
      subscriptionId: subscription.id,
      runAt,
      maxAttempts: 1
    }).catch((err) => {
      logger.warn({ err, subscriptionId: subscription.id, runAt }, "Fallo reprogramando job de cobro");
    });
  }
}

export async function updateWompiSettings(input: unknown) {
  const parsed = wompiUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const { environment, activeEnv, publicKey, privateKey, integritySecret, eventsSecret, apiBaseUrl, checkoutLinkBaseUrl, redirectUrl } =
    parsed.data;
  const env: ActiveEnv = environment || "PRODUCTION";

  try {
    if (activeEnv) await setCredential(CredentialProvider.WOMPI, "ACTIVE_ENV", activeEnv);
    if (publicKey) await setCredential(CredentialProvider.WOMPI, `PUBLIC_KEY_${env}`, publicKey);
    if (privateKey) await setCredential(CredentialProvider.WOMPI, `PRIVATE_KEY_${env}`, privateKey);
    if (integritySecret) await setCredential(CredentialProvider.WOMPI, `INTEGRITY_SECRET_${env}`, integritySecret);
    if (eventsSecret) await setCredential(CredentialProvider.WOMPI, `EVENTS_SECRET_${env}`, eventsSecret);
    if (apiBaseUrl) await setCredential(CredentialProvider.WOMPI, `API_BASE_URL_${env}`, apiBaseUrl);
    if (checkoutLinkBaseUrl) await setCredential(CredentialProvider.WOMPI, `CHECKOUT_LINK_BASE_URL_${env}`, checkoutLinkBaseUrl);
    if (redirectUrl != null) await setCredential(CredentialProvider.WOMPI, `REDIRECT_URL_${env}`, redirectUrl);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.wompi", "Credenciales de Wompi actualizadas").catch((err: any) => {
    logger.warn({ err, env }, "Fallo escribiendo systemLog al actualizar credenciales de Wompi");
  });
  return { ok: true as const };
}

export async function testWompiConnection(input: unknown) {
  const parsed = wompiTestSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
  const publicKeyInput = String(parsed.data.publicKey || "").trim();
  const apiBaseInput = String(parsed.data.apiBaseUrl || "").trim();

  const publicKey =
    publicKeyInput ||
    (await getCredential(CredentialProvider.WOMPI, `PUBLIC_KEY_${env}`)) ||
    (await getCredential(CredentialProvider.WOMPI, "PUBLIC_KEY")) ||
    "";
  const apiBaseUrl =
    apiBaseInput ||
    (await getCredential(CredentialProvider.WOMPI, `API_BASE_URL_${env}`)) ||
    (await getCredential(CredentialProvider.WOMPI, "API_BASE_URL")) ||
    (env === "SANDBOX" ? "https://sandbox.wompi.co/v1" : "https://api.wompi.co/v1");

  if (!publicKey) {
    return { ok: false as const, status: 400, error: "wompi_public_key_not_configured" as const, message: "La llave pública no está configurada" };
  }

  try {
    const wompi = new WompiClient({ apiBaseUrl, privateKey: "unused", checkoutLinkBaseUrl: "https://checkout.wompi.co/l/" });
    const merchantInfo = await wompi.getMerchant(publicKey);
    if (!merchantInfo || typeof merchantInfo !== "object") {
      throw new Error("Respuesta inválida de Wompi");
    }

    return {
      ok: true as const,
      message: `Conexión exitosa con ${env === "SANDBOX" ? "Sandbox" : "Producción"}`,
      environment: env
    };
  } catch (err: any) {
    const errorMsg = String(err?.message || err);
    let userMessage = errorMsg;
    if (errorMsg.includes("401") || errorMsg.includes("unauthorized")) {
      userMessage = "Llave pública inválida o expirada";
    } else if (errorMsg.includes("403")) {
      userMessage = "Acceso denegado - verifica tus credenciales";
    } else if (errorMsg.includes("ENOTFOUND") || errorMsg.includes("network")) {
      userMessage = "No se pudo conectar con Wompi - verifica tu conexión a internet";
    } else if (env === "SANDBOX" && errorMsg.includes("404")) {
      userMessage = "Endpoint de Sandbox no encontrado - verifica la URL base";
    }
    return { ok: false as const, status: 400, error: "wompi_test_failed" as const, message: userMessage };
  }
}

export async function deleteWompiSettings(input: unknown) {
  const parsed = envOnlySchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
  const keys = [
    `PUBLIC_KEY_${env}`,
    `PRIVATE_KEY_${env}`,
    `INTEGRITY_SECRET_${env}`,
    `EVENTS_SECRET_${env}`,
    `API_BASE_URL_${env}`,
    `CHECKOUT_LINK_BASE_URL_${env}`,
    `REDIRECT_URL_${env}`
  ];

  try {
    await Promise.all(
      keys.map((key) =>
        clearCredential(CredentialProvider.WOMPI, key).catch((err: any) => {
          logger.warn({ err, env, key }, "Fallo eliminando credencial de Wompi");
        })
      )
    );
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.wompi", "Credenciales de Wompi eliminadas", { env }).catch((err: any) => {
    logger.warn({ err, env }, "Fallo escribiendo systemLog al eliminar credenciales de Wompi");
  });
  return { ok: true as const };
}

export async function updateShopifySettings(input: unknown) {
  const parsed = shopifyUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  try {
    if (parsed.data.forwardUrl != null) await setCredential(CredentialProvider.SHOPIFY, "FORWARD_URL", parsed.data.forwardUrl);
    if (parsed.data.forwardSecret != null) await setCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET", parsed.data.forwardSecret);
    if (parsed.data.forwardOrigin != null) {
      await setCredential(CredentialProvider.SHOPIFY, "FORWARD_ORIGIN", parsed.data.forwardOrigin);
    }
    if (parsed.data.forwardRetryEnabled != null) {
      await setCredential(
        CredentialProvider.SHOPIFY,
        "FORWARD_RETRY_ENABLED",
        String(parsed.data.forwardRetryEnabled).toLowerCase() === "false" ? "false" : "true"
      );
    }
    if (parsed.data.forwardRetryMinutes != null) {
      await setCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES", String(parsed.data.forwardRetryMinutes));
    }
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.reenvio", "Configuración de reenvío actualizada").catch((err: any) => {
    logger.warn({ err }, "Fallo escribiendo systemLog al actualizar configuracion de reenvio");
  });
  return { ok: true as const };
}

export async function deleteShopifySettings() {
  try {
    await Promise.all([
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_URL").catch((err: any) => {
        logger.warn({ err, key: "FORWARD_URL" }, "Fallo eliminando credencial de Shopify forward");
      }),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_SECRET").catch((err: any) => {
        logger.warn({ err, key: "FORWARD_SECRET" }, "Fallo eliminando credencial de Shopify forward");
      }),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_ORIGIN").catch((err: any) => {
        logger.warn({ err, key: "FORWARD_ORIGIN" }, "Fallo eliminando credencial de Shopify forward");
      }),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_ENABLED").catch((err: any) => {
        logger.warn({ err, key: "FORWARD_RETRY_ENABLED" }, "Fallo eliminando credencial de Shopify forward");
      }),
      clearCredential(CredentialProvider.SHOPIFY, "FORWARD_RETRY_MINUTES").catch((err: any) => {
        logger.warn({ err, key: "FORWARD_RETRY_MINUTES" }, "Fallo eliminando credencial de Shopify forward");
      })
    ]);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.reenvio", "Configuración de reenvío eliminada").catch((err: any) => {
    logger.warn({ err }, "Fallo escribiendo systemLog al eliminar configuracion de reenvio");
  });
  return { ok: true as const };
}

export async function testShopifyForward(input: unknown) {
  const schema = shopifyUpdateSchema.pick({ forwardUrl: true, forwardSecret: true, forwardOrigin: true });
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const stored = await getShopifyForward();
  const forwardUrl = parsed.data.forwardUrl || stored.url || "";
  const forwardSecret = parsed.data.forwardSecret || stored.secret || "";
  const origin = parsed.data.forwardOrigin || stored.origin || "shopify";

  if (!forwardUrl) return { ok: false as const, status: 400, error: "forward_not_configured" as const };

  const payload = {
    event: "wompi.forward.test",
    data: {
      origin,
      transaction: {
        id: "test_txn",
        origin,
        status: "APPROVED",
        amount_in_cents: 1000,
        currency: "COP",
        reference: "SHOPIFY_TEST"
      }
    },
    sent_at: new Date().toISOString(),
    timestamp: Date.now(),
    origin
  };

  const headers = {
    "x-forwarded-by": "wompi-subs-api",
    ...(forwardSecret ? { "x-forwarded-secret": forwardSecret } : {})
  } as Record<string, string>;

  const out = await postJson(forwardUrl, payload, headers);
  if (!out.ok) {
    return { ok: false as const, status: 400, error: "forward_failed" as const, details: { status: out.status, text: out.text } };
  }
  return { ok: true as const, status: out.status };
}

export async function updateChatwootSettings(input: unknown) {
  const parsed = chatwootUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  try {
    const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
    if (parsed.data.activeEnv) await setCredential(CredentialProvider.CHATWOOT, "ACTIVE_ENV", parsed.data.activeEnv);
    if (parsed.data.baseUrl != null) await setCredential(CredentialProvider.CHATWOOT, `BASE_URL_${env}`, parsed.data.baseUrl);
    if (parsed.data.accountId != null) await setCredential(CredentialProvider.CHATWOOT, `ACCOUNT_ID_${env}`, String(parsed.data.accountId));
    if (parsed.data.apiAccessToken != null)
      await setCredential(CredentialProvider.CHATWOOT, `API_ACCESS_TOKEN_${env}`, parsed.data.apiAccessToken);
    if (parsed.data.inboxId != null) await setCredential(CredentialProvider.CHATWOOT, `INBOX_ID_${env}`, String(parsed.data.inboxId));
    if (parsed.data.productTemplateName != null)
      await setCredential(CredentialProvider.CHATWOOT, `PRODUCT_TEMPLATE_NAME_${env}`, parsed.data.productTemplateName);
    if (parsed.data.productTemplateLang != null)
      await setCredential(CredentialProvider.CHATWOOT, `PRODUCT_TEMPLATE_LANG_${env}`, parsed.data.productTemplateLang);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.comunicaciones", "Credenciales de la central de comunicaciones actualizadas").catch((err: any) => {
    logger.warn({ err }, "Fallo escribiendo systemLog al actualizar credenciales de comunicaciones");
  });
  return { ok: true as const };
}

export async function deleteChatwootSettings(input: unknown) {
  const parsed = chatwootUpdateSchema.pick({ environment: true }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  try {
    const env: ActiveEnv = parsed.data.environment || "PRODUCTION";
    await setCredential(CredentialProvider.CHATWOOT, `BASE_URL_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `ACCOUNT_ID_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `INBOX_ID_${env}`, "");
    await setCredential(CredentialProvider.CHATWOOT, `API_ACCESS_TOKEN_${env}`, "");
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.comunicaciones", "Credenciales de la central de comunicaciones eliminadas").catch((err: any) => {
    logger.warn({ err }, "Fallo escribiendo systemLog al eliminar credenciales de comunicaciones");
  });
  return { ok: true as const };
}

export async function updateAutoDebitConfig(input: unknown) {
  const parsed = autoDebitUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const currentRaw = (await getCredential(CredentialProvider.WOMPI, "AUTO_DEBIT_CONFIG")) || "";
  let current: any = {};
  try {
    current = currentRaw ? JSON.parse(currentRaw) : {};
  } catch (err: any) {
    logger.warn({ err }, "Fallo parseando AUTO_DEBIT_CONFIG actual");
    current = {};
  }

  const enabled = parsed.data.enabled != null ? toBool(parsed.data.enabled, true) : toBool(current?.enabled, true);
  const chargeAtCutoffEnabled =
    parsed.data.chargeAtCutoffEnabled != null
      ? toBool(parsed.data.chargeAtCutoffEnabled, true)
      : toBool(current?.chargeAtCutoffEnabled, true);
  const allowManualCharge =
    parsed.data.allowManualCharge != null ? toBool(parsed.data.allowManualCharge, true) : toBool(current?.allowManualCharge, true);
  const executionHour = String(parsed.data.executionHour || current?.executionHour || "09:00").trim() || "09:00";
  const timeZone = String(parsed.data.timeZone || current?.timeZone || current?.timezone || "America/Bogota").trim() || "America/Bogota";
  const retryEnabled = parsed.data.retryEnabled != null ? toBool(parsed.data.retryEnabled, false) : toBool(current?.retryEnabled, false);
  const retryUnit = parsed.data.retryEveryUnit ? normalizeRetryUnit(parsed.data.retryEveryUnit) : normalizeRetryUnit(current?.retryEveryUnit);
  const retryValue =
    parsed.data.retryEveryValue != null ? toInt(parsed.data.retryEveryValue, 1, 1, 10080) : toInt(current?.retryEveryValue, 0, 0, 10080);
  const retryEveryMinutes =
    retryValue > 0
      ? toInt(retryValue * retryUnitMultiplier(retryUnit), 60, 1, 10080)
      : parsed.data.retryEveryMinutes != null
      ? toInt(parsed.data.retryEveryMinutes, 60, 1, 10080)
      : toInt(current?.retryEveryMinutes, 60, 1, 10080);
  const derived = deriveRetryUnitAndValue(retryEveryMinutes);
  const maxRetriesRaw = parsed.data.maxRetries != null ? toInt(parsed.data.maxRetries, 0, 0, 20) : toInt(current?.maxRetries, 0, 0, 20);
  const maxRetries = retryEnabled ? Math.max(1, maxRetriesRaw) : maxRetriesRaw;
  const graceDays = parsed.data.graceDays != null ? toInt(parsed.data.graceDays, 5, 1, 30) : toInt(current?.graceDays, 5, 1, 30);
  const suspendDays = parsed.data.suspendDays != null ? toInt(parsed.data.suspendDays, 15, 1, 180) : toInt(current?.suspendDays, 15, 1, 180);
  const cancelDays = parsed.data.cancelDays != null ? toInt(parsed.data.cancelDays, 30, 1, 365) : toInt(current?.cancelDays, 30, 1, 365);

  await setCredential(
    CredentialProvider.WOMPI,
    "AUTO_DEBIT_CONFIG",
    JSON.stringify({
      enabled,
      chargeAtCutoffEnabled,
      allowManualCharge,
      executionHour,
      timeZone,
      retryEnabled,
      retryEveryValue: derived.retryEveryValue,
      retryEveryUnit: derived.retryEveryUnit,
      retryEveryMinutes,
      maxRetries,
      graceDays,
      suspendDays,
      cancelDays
    })
  );
  await prisma.subscription.updateMany({
    data: {
      graceDays
    }
  }).catch((err) => {
    logger.warn({ err, graceDays }, "Fallo sincronizando graceDays global sobre suscripciones");
  });
  const subscriptions = await loadSubscriptionsForBillingScheduleRefresh().catch((err) => {
    logger.warn({ err }, "Fallo cargando suscripciones para recalcular programación operativa");
    return [] as BillingScheduleSubscription[];
  });
  await rebuildBillingSchedulesAfterConfigChange(subscriptions).catch((err) => {
    logger.warn({ err }, "Fallo recalculando billing cycles tras actualizar configuración de débito automático");
  });
  await cancelPendingOperationalJobsAfterAutoDebitConfigChange().catch((err) => {
    logger.warn({ err }, "Fallo cancelando jobs pendientes tras actualizar configuración de débito automático");
  });
  await rebuildOperationalSchedulesAfterConfigChange(subscriptions).catch((err) => {
    logger.warn({ err }, "Fallo reprogramando jobs operativos tras actualizar configuración de débito automático");
  });
  await systemLog(LogLevel.INFO, "configuracion.auto_debito", "Configuración de débito automático actualizada", {
    enabled,
    chargeAtCutoffEnabled,
    allowManualCharge,
    executionHour,
    timeZone,
    retryEnabled,
    retryEveryValue: derived.retryEveryValue,
    retryEveryUnit: derived.retryEveryUnit,
    retryEveryMinutes,
    maxRetries,
    graceDays,
    suspendDays,
    cancelDays
  }).catch((err: any) => {
    logger.warn({ err }, "Fallo escribiendo systemLog al actualizar configuracion de debito automatico");
  });
  return { ok: true as const };
}

export async function updatePaymentsConfig(input: unknown) {
  const parsed = paymentsConfigUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const currentRaw = (await getCredential(CredentialProvider.WOMPI, "PAYMENTS_CONFIG")) || "";
  let current: any = {};
  try {
    current = currentRaw ? JSON.parse(currentRaw) : {};
  } catch (err: any) {
    logger.warn({ err }, "Fallo parseando PAYMENTS_CONFIG actual");
    current = {};
  }

  const autoReconcileUnlinkedPayments =
    parsed.data.autoReconcileUnlinkedPayments != null
      ? toBool(parsed.data.autoReconcileUnlinkedPayments, true)
      : toBool(current?.autoReconcileUnlinkedPayments, true);
  const acceptUnlinkedPayments =
    parsed.data.acceptUnlinkedPayments != null ? toBool(parsed.data.acceptUnlinkedPayments, true) : toBool(current?.acceptUnlinkedPayments, true);
  const notifyWhatsappForUnlinkedPayments =
    parsed.data.notifyWhatsappForUnlinkedPayments != null
      ? toBool(parsed.data.notifyWhatsappForUnlinkedPayments, true)
      : toBool(current?.notifyWhatsappForUnlinkedPayments, true);
  const includeUnlinkedPaymentsInMetrics =
    parsed.data.includeUnlinkedPaymentsInMetrics != null
      ? toBool(parsed.data.includeUnlinkedPaymentsInMetrics, true)
      : toBool(current?.includeUnlinkedPaymentsInMetrics, true);
  await setCredential(
    CredentialProvider.WOMPI,
    "PAYMENTS_CONFIG",
    JSON.stringify({
      autoReconcileUnlinkedPayments,
      acceptUnlinkedPayments,
      notifyWhatsappForUnlinkedPayments,
      includeUnlinkedPaymentsInMetrics
    })
  );
  await systemLog(LogLevel.INFO, "configuracion.pagos", "Configuración de pagos actualizada", {
    autoReconcileUnlinkedPayments,
    acceptUnlinkedPayments,
    notifyWhatsappForUnlinkedPayments,
    includeUnlinkedPaymentsInMetrics
  }).catch((err: any) => {
    logger.warn({ err }, "Fallo escribiendo systemLog al actualizar configuracion de pagos");
  });
  return { ok: true as const };
}

export async function updateCheckoutConfig(input: unknown) {
  const parsed = checkoutConfigUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const payload = checkoutConfigSchema.parse({
    planBaseUrl: parsed.data.planBaseUrl || "",
    subscriptionBaseUrl: parsed.data.subscriptionBaseUrl || "",
    cartBaseUrl: parsed.data.cartBaseUrl || "",
    defaultUtmParams: parsed.data.defaultUtmParams || "",
    tokenExpiryHours: parsed.data.tokenExpiryHours || undefined,
    defaultPlanTemplateId: parsed.data.defaultPlanTemplateId || "",
    defaultSubscriptionTemplateId: parsed.data.defaultSubscriptionTemplateId || "",
    defaultCartTemplateId: parsed.data.defaultCartTemplateId || "",
    logoUrl: parsed.data.logoUrl || "",
    supportEmail: parsed.data.supportEmail || "",
    supportUrl: parsed.data.supportUrl || "",
    planTitle: parsed.data.planTitle || "",
    planDescription: parsed.data.planDescription || "",
    subscriptionTitle: parsed.data.subscriptionTitle || "",
    subscriptionDescription: parsed.data.subscriptionDescription || "",
    planWompiTitle: parsed.data.planWompiTitle || "",
    planWompiDescription: parsed.data.planWompiDescription || "",
    subscriptionWompiTitle: parsed.data.subscriptionWompiTitle || "",
    subscriptionWompiDescription: parsed.data.subscriptionWompiDescription || "",
    tokenizationSuccessTitle: parsed.data.tokenizationSuccessTitle || "",
    tokenizationSuccessMessage: parsed.data.tokenizationSuccessMessage || "",
    tokenizationErrorMessage: parsed.data.tokenizationErrorMessage || "",
    tokenizationReturnUrl: parsed.data.tokenizationReturnUrl || ""
  });

  await setCredential(CredentialProvider.WOMPI, "CHECKOUT_CONFIG", JSON.stringify(payload));
  await systemLog(LogLevel.INFO, "settings.checkout_config", "Checkout config updated");
  return { ok: true as const };
}

export async function updateAiProvider(input: unknown) {
  const parsed = aiUpdateSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const aiAccess = await getGlobalModuleAccess("ai");
  if (!aiAccess.enabled) return { ok: false as const, status: 403, error: "ai_disabled" as const, reason: aiAccess.reason };

  const provider = parsed.data.provider;
  const credentialProvider = provider === "DEEPSEEK" ? CredentialProvider.DEEPSEEK : CredentialProvider.OPENAI;

  try {
    if (parsed.data.apiKey != null) await setCredential(credentialProvider, "API_KEY", parsed.data.apiKey);
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.ia", "Configuración de IA actualizada", { provider }).catch((err: any) => {
    logger.warn({ err, provider }, "Fallo escribiendo systemLog al actualizar configuracion de IA");
  });
  return { ok: true as const };
}

export async function deleteAiProvider(input: unknown) {
  const parsed = aiDeleteSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const aiAccess = await getGlobalModuleAccess("ai");
  if (!aiAccess.enabled) return { ok: false as const, status: 403, error: "ai_disabled" as const, reason: aiAccess.reason };

  const provider = parsed.data.provider;
  const credentialProvider = provider === "DEEPSEEK" ? CredentialProvider.DEEPSEEK : CredentialProvider.OPENAI;

  try {
    await clearCredential(credentialProvider, "API_KEY");
  } catch (err: any) {
    return { ok: false as const, status: 400, error: "credentials_error" as const, message: String(err?.message || err) };
  }

  await systemLog(LogLevel.INFO, "configuracion.ia", "Configuración de IA eliminada", { provider }).catch((err: any) => {
    logger.warn({ err, provider }, "Fallo escribiendo systemLog al eliminar configuracion de IA");
  });
  return { ok: true as const };
}
