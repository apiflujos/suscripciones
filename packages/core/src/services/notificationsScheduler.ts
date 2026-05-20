import { LogLevel, PaymentStatus, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { applyClockTimeInZone } from "../lib/timeZoneScheduling";
import {
  filterNotificationRules,
  getNotificationsActiveEnv,
  getNotificationsConfig,
  NotificationRule,
  NotificationTrigger
} from "./notificationsConfig";
import type {
  CatalogLinkCreatedJobPayload,
  NotificationJobPayload,
  PaymentLinkCreatedJobPayload,
  PaymentStatusJobPayload,
  SubscriptionDueJobPayload,
  TokenizationLinkCreatedJobPayload
} from "./notificationJobPayloads";
import { getAutoDebitConfig, getAppTimeZone, getPaymentsConfig } from "./runtimeConfig";
import { systemLog, SystemActor } from "./systemLog";
import { subscriptionReminder } from "../jobs/handlers/subscriptionReminder";
import { classifyReference } from "../webhooks/wompi/classifyReference";
import { resolveSubscriptionBillingState } from "./billingCycles";
import { resolveSubscriptionCollectionMode } from "./subscriptionMode";
import type { NotificationScheduleResult } from "./notificationDelivery";
import { normalizePublicUrl } from "./publicBase";

function toMsSeconds(seconds: number) {
  return seconds * 1000;
}

function resolveOffsetsSeconds(rule: NotificationRule) {
  if (Array.isArray(rule.offsetsSeconds) && rule.offsetsSeconds.length) return rule.offsetsSeconds;
  if (Array.isArray(rule.offsetsMinutes) && rule.offsetsMinutes.length) {
    return rule.offsetsMinutes.map((m) => m * 60);
  }
  return [0];
}

function clampRunAt(runAt: Date, now: Date) {
  return runAt.getTime() < now.getTime() ? now : runAt;
}

async function resolveScheduledRunAt(args: { base: Date; atTime?: string | null }) {
  const atTime = String(args.atTime || "").trim();
  if (!atTime) return args.base;
  const timeZone =
    (await getAutoDebitConfig().then((cfg) => String(cfg?.timeZone || "").trim()).catch(() => "")) ||
    (await getAppTimeZone().catch(() => "America/Bogota"));
  return applyClockTimeInZone(args.base, atTime, timeZone);
}

async function enqueueNotificationJob(runAt: Date, payload: NotificationJobPayload) {
  await prisma.retryJob.create({
    data: {
      type: RetryJobType.SUBSCRIPTION_REMINDER,
      runAt,
      payload
    }
  });
}

export async function scheduleSubscriptionDueNotifications(args: { subscriptionId: string; forceNow?: boolean; actor?: string }): Promise<NotificationScheduleResult> {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      customerId: true
    }
  });
  if (!sub) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const billingState = await resolveSubscriptionBillingState({ subscriptionId: sub.id });
  const collectionCycle = billingState?.collectionCycle || null;
  if (!collectionCycle) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const cfg = await getNotificationsConfig();
  const resolvedMode = billingState?.subscription ? resolveSubscriptionCollectionMode(billingState.subscription as any) : null;
  const paymentType = resolvedMode === "AUTO_DEBIT" ? "SUBSCRIPTION" : "LINK";
  const rules = filterNotificationRules({
    rules: cfg.rules,
    trigger: "SUBSCRIPTION_DUE",
    paymentType
  });
  if (!rules.length) {
    return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
  }

  const now = new Date();
  const anchorAt = new Date(collectionCycle.dueAt || collectionCycle.periodEndAt);
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  let sentNow = 0;
  const errors: string[] = [];
  for (const rule of rules) {
    const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
    const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const payload: SubscriptionDueJobPayload = {
        trigger: "SUBSCRIPTION_DUE",
        ruleId: rule.id,
        offsetSeconds,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        cycleNumber: collectionCycle.cycleNumber,
        anchorAt: anchorIso
      };
      if (!args.forceNow) {
        const existing = await prisma.retryJob.findFirst({
          where: {
            type: RetryJobType.SUBSCRIPTION_REMINDER,
            payload: { path: ["subscriptionId"], equals: sub.id } as any,
            AND: [
              { payload: { path: ["ruleId"], equals: rule.id } as any },
              { payload: { path: ["offsetSeconds"], equals: offsetSeconds } as any },
              { payload: { path: ["cycleNumber"], equals: collectionCycle.cycleNumber } as any },
              { payload: { path: ["anchorAt"], equals: anchorIso } as any }
            ]
          } as any
        });
        if (existing) continue;
        await enqueueNotificationJob(runAt, payload);
        scheduled++;
      } else {
        const result = await subscriptionReminder({ ...payload, immediateSend: true }).catch((err) => {
          logger.warn({ err, subscriptionId: sub.id }, '[Notifications/Schedule] Fallo en envío inline de subscription due');
          return { ok: false, error: err?.message ? String(err.message) : "unknown_error" } as const;
        });
        if (result && "ok" in result && result.ok) sentNow++;
        else if (result && "ok" in result && !result.ok) errors.push((result as any).error || "chatwoot_send_failed");
      }
    }
  }

  await systemLog(
    LogLevel.INFO,
    "notifications.schedule",
    "Notificaciones programadas",
    {
      trigger: "SUBSCRIPTION_DUE",
      environment: await getNotificationsActiveEnv(),
      subscriptionId: sub.id,
      customerId: sub.customerId,
      currentPeriodEndAt: new Date(collectionCycle.periodEndAt).toISOString(),
      rulesCount: rules.length,
      scheduled,
      sentNow
    },
    args.actor || SystemActor.JOB_SUBSCRIPTION_REMINDER
  ).catch((err) => {
    logger.warn({ err, subscriptionId: sub.id }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled, sentNow, rulesActive: rules.length > 0, errors };
}

export async function schedulePaymentStatusNotifications(args: { paymentId: string; forceNow?: boolean; actor?: string }): Promise<NotificationScheduleResult> {
  const paymentId = String(args.paymentId || "").trim();
  if (!paymentId) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, customerId: true, subscriptionId: true, status: true, providerResponse: true, reference: true }
  });
  if (!payment) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const paymentsCfg = await getPaymentsConfig().catch(() => null);
  const reconciliationStatus = (() => {
    const resp: any = payment.providerResponse && typeof payment.providerResponse === "object" ? (payment.providerResponse as any) : null;
    return String(resp?.reconciliation?.status || "").toUpperCase();
  })();
  if (reconciliationStatus === "IGNORED_EXTERNAL") return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
  if (!payment.subscriptionId && paymentsCfg && paymentsCfg.notifyWhatsappForUnlinkedPayments === false) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const referenceInfo = classifyReference(payment.reference);
  const isInternalRef = referenceInfo.kind === "subscription" || referenceInfo.kind === "order";
  const isShopifyRef = referenceInfo.kind === "shopify";
  if (!payment.subscriptionId && !isInternalRef) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
  if (isShopifyRef) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const trigger: NotificationTrigger | null =
    payment.status === PaymentStatus.APPROVED ? "PAYMENT_APPROVED" : payment.status === PaymentStatus.DECLINED ? "PAYMENT_DECLINED" : null;
  if (!trigger) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };

  const cfg = await getNotificationsConfig();
  const billingState = payment.subscriptionId ? await resolveSubscriptionBillingState({ subscriptionId: payment.subscriptionId }).catch(() => null) : null;
  const resolvedMode = billingState?.subscription ? resolveSubscriptionCollectionMode(billingState.subscription as any) : null;
  const paymentType =
    resolvedMode === "AUTO_LINK" || resolvedMode === "MANUAL_LINK"
      ? "LINK"
      : payment.subscriptionId
        ? "SUBSCRIPTION"
        : "LINK";
  const rules = filterNotificationRules({ rules: cfg.rules, trigger, paymentType });
  if (!rules.length) {
    return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  let sentNow = 0;
  const errors: string[] = [];
  for (const rule of rules) {
    const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
    const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const jobPayload: PaymentStatusJobPayload = {
        trigger,
        ruleId: rule.id,
        offsetSeconds,
        paymentId: payment.id,
        customerId: payment.customerId,
        subscriptionId: payment.subscriptionId,
        paymentStatus: payment.status,
        anchorAt: anchorIso,
        paymentType
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await enqueueNotificationJob(runAt, jobPayload);
        scheduled++;
      } else {
        const result = await subscriptionReminder({ ...jobPayload, immediateSend: true }).catch((err) => {
          logger.warn({ err, paymentId, trigger }, '[Notifications/Schedule] Fallo en envío inline de payment status');
          return { ok: false, error: err?.message ? String(err.message) : "unknown_error" } as const;
        });
        if (result && "ok" in result && result.ok) sentNow++;
        else if (result && "ok" in result && !result.ok) errors.push((result as any).error || "chatwoot_send_failed");
      }
    }
  }

  await systemLog(
    LogLevel.INFO,
    "notifications.schedule",
    "Notificaciones programadas",
    {
      trigger,
      environment: await getNotificationsActiveEnv(),
      paymentId: payment.id,
      scheduled,
      sentNow
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled, sentNow, rulesActive: rules.length > 0, errors };
}

export async function schedulePaymentLinkNotifications(args: {
  paymentId: string;
  paymentLinkUrl?: string;
  forceNow?: boolean;
  actor?: string;
}) {
  const paymentId = String(args.paymentId || "").trim();
  if (!paymentId) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };
  const paymentLinkUrl = normalizePublicUrl(args.paymentLinkUrl);

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, customerId: true, subscriptionId: true }
  });
  if (!payment) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };

  const cfg = await getNotificationsConfig();
  const billingState = payment.subscriptionId ? await resolveSubscriptionBillingState({ subscriptionId: payment.subscriptionId }).catch(() => null) : null;
  const resolvedMode = billingState?.subscription ? resolveSubscriptionCollectionMode(billingState.subscription as any) : null;
  const paymentType =
    resolvedMode === "AUTO_LINK" || resolvedMode === "MANUAL_LINK"
      ? "LINK"
      : payment.subscriptionId
        ? "SUBSCRIPTION"
        : "LINK";
  const rules = filterNotificationRules({ rules: cfg.rules, trigger: "PAYMENT_LINK_CREATED", paymentType });
  if (!rules.length) {
    return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  let sentNow = 0;
  const errors: string[] = [];
  for (const rule of rules) {
      const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
      const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
      for (const offsetSeconds of offsetsSeconds) {
        const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const jobPayload: PaymentLinkCreatedJobPayload = {
        trigger: "PAYMENT_LINK_CREATED",
        ruleId: rule.id,
        offsetSeconds,
        paymentId: payment.id,
        customerId: payment.customerId,
        ...(payment.subscriptionId ? { subscriptionId: payment.subscriptionId } : {}),
        anchorAt: anchorIso,
        paymentType,
        ...(paymentLinkUrl ? { paymentLinkUrl } : {}),
        ...(args.forceNow ? { immediateSend: true } : {})
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await enqueueNotificationJob(runAt, jobPayload);
        scheduled++;
      } else {
        const result = await subscriptionReminder(jobPayload).catch((err) => {
          logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo en envío inline de payment link');
          return { ok: false, error: err?.message ? String(err.message) : "unknown_error" } as const;
        });
        if (result && "ok" in result && !result.ok) {
          errors.push((result as any).error || "chatwoot_send_failed");
        } else {
          sentNow++;
        }
      }
    }
  }

  const logLevel =
    args.forceNow
      ? sentNow > 0
        ? LogLevel.INFO
        : LogLevel.WARN
      : scheduled > 0
        ? LogLevel.INFO
        : LogLevel.WARN;

  await systemLog(
    logLevel,
    "notifications.schedule",
    args.forceNow
      ? sentNow > 0
        ? "Notificaciones enviadas"
        : "Notificaciones sin entrega"
      : scheduled > 0
        ? "Notificaciones programadas"
        : "Notificaciones sin programación",
    {
      trigger: "PAYMENT_LINK_CREATED",
      environment: await getNotificationsActiveEnv(),
      paymentId: payment.id,
      customerId: payment.customerId,
      paymentType,
      scheduled,
      sentNow,
      errorsCount: errors.length
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled, sentNow, rulesActive: true, errors };
}

export async function scheduleCatalogLinkNotifications(args: { customerId: string; catalogUrl: string; forceNow?: boolean; paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK" | ""; actor?: string }) {
  const customerId = String(args.customerId || "").trim();
  const catalogUrl = normalizePublicUrl(args.catalogUrl);
  if (!customerId || !catalogUrl) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };

  const cfg = await getNotificationsConfig();
  const rules = filterNotificationRules({ rules: cfg.rules, trigger: "CATALOG_LINK_CREATED", paymentType: args.paymentType || undefined });
  if (!rules.length) {
    return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();
  let scheduled = 0;
  let sentNow = 0;
  const errors: string[] = [];

  for (const rule of rules) {
    const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
    const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const jobPayload: CatalogLinkCreatedJobPayload = {
        trigger: "CATALOG_LINK_CREATED",
        ruleId: rule.id,
        offsetSeconds,
        customerId,
        catalogUrl,
        anchorAt: anchorIso,
        immediateSend: args.forceNow,
        ...(args.paymentType ? { paymentType: args.paymentType } : {})
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await enqueueNotificationJob(runAt, jobPayload);
        scheduled++;
      } else {
        const result = await subscriptionReminder(jobPayload).catch((err) => {
          logger.warn({ err, customerId }, '[Notifications/Schedule] Fallo en envío inline de catalog link');
          return { ok: false, error: err?.message ? String(err.message) : "unknown_error" } as const;
        });
        if (result && "ok" in result && result.ok) sentNow++;
        else if (result && "ok" in result && !result.ok) errors.push((result as any).error || "chatwoot_send_failed");
      }
    }
  }

  const logLevel =
    args.forceNow
      ? sentNow > 0
        ? LogLevel.INFO
        : LogLevel.WARN
      : scheduled > 0
        ? LogLevel.INFO
        : LogLevel.WARN;

  await systemLog(
    logLevel,
    "notifications.schedule",
    args.forceNow
      ? sentNow > 0
        ? "Notificaciones enviadas"
        : "Notificaciones sin entrega"
      : scheduled > 0
        ? "Notificaciones programadas"
        : "Notificaciones sin programación",
    {
      trigger: "CATALOG_LINK_CREATED",
      environment: await getNotificationsActiveEnv(),
      customerId,
      scheduled,
      sentNow,
      errorsCount: errors.length
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, customerId }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled, sentNow, rulesActive: true, errors };
}

export async function scheduleTokenizationLinkNotifications(args: {
  customerId: string;
  tokenUrl: string;
  tenantId?: string | null;
  planId?: string | null;
  productId?: string | null;
  forceNow?: boolean;
  actor?: string;
}) {
  const customerId = String(args.customerId || "").trim();
  const tokenUrl = normalizePublicUrl(args.tokenUrl);
  if (!customerId || !tokenUrl) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };

  const cfg = await getNotificationsConfig();
  const rules = filterNotificationRules({ rules: cfg.rules, trigger: "TOKENIZATION_LINK_CREATED" });
  if (!rules.length) {
    return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();
  let scheduled = 0;
  let sentNow = 0;
  const errors: string[] = [];

  for (const rule of rules) {
    const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
    const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const jobPayload: TokenizationLinkCreatedJobPayload = {
        trigger: "TOKENIZATION_LINK_CREATED",
        ruleId: rule.id,
        offsetSeconds,
        customerId,
        tokenUrl,
        anchorAt: anchorIso,
        tenantId: String(args.tenantId || "").trim() || undefined,
        planId: String(args.planId || "").trim() || undefined,
        productId: String(args.productId || "").trim() || undefined,
        immediateSend: args.forceNow
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await enqueueNotificationJob(runAt, jobPayload);
        scheduled++;
      } else {
        const result = await subscriptionReminder(jobPayload).catch((err) => {
          logger.warn({ err, customerId, trigger: "TOKENIZATION_LINK_CREATED" }, "[Notifications/Schedule] Fallo en envío inline de tokenización");
          return { ok: false, error: err?.message ? String(err.message) : "unknown_error" } as const;
        });
        if (result && "ok" in result && result.ok) sentNow++;
        else if (result && "ok" in result && !result.ok) errors.push((result as any).error || "chatwoot_send_failed");
      }
    }
  }

  const logMessage = args.forceNow
    ? sentNow > 0
      ? "Notificaciones enviadas"
      : "Notificaciones sin entrega"
    : scheduled > 0
      ? "Notificaciones programadas"
      : "Notificaciones sin programación";

  const logLevel =
    args.forceNow
      ? sentNow > 0
        ? LogLevel.INFO
        : LogLevel.WARN
      : scheduled > 0
        ? LogLevel.INFO
        : LogLevel.WARN;

  await systemLog(
    logLevel,
    "notifications.schedule",
    logMessage,
    {
      trigger: "TOKENIZATION_LINK_CREATED",
      environment: await getNotificationsActiveEnv(),
      customerId,
      scheduled,
      sentNow,
      errorsCount: errors.length
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, customerId }, "[Notifications/Schedule] Fallo creando systemLog de tokenización");
  });

  return { scheduled, sentNow, rulesActive: true, errors };
}
