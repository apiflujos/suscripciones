import { LogLevel, PaymentStatus, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { getNotificationsActiveEnv, getNotificationsConfig, NotificationTrigger } from "./notificationsConfig";
import { getAppTimeZone, getPaymentsConfig } from "./runtimeConfig";
import { systemLog, SystemActor } from "./systemLog";
import { subscriptionReminder } from "../jobs/handlers/subscriptionReminder";
import { classifyReference } from "../webhooks/wompi/classifyReference";
import { resolveSubscriptionBillingState } from "./billingCycles";

type NotificationRule = {
  id: string;
  enabled: boolean;
  trigger: NotificationTrigger;
  offsetsSeconds?: number[];
  offsetsMinutes?: number[];
  atTimeUtc?: string;
};

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

function getZonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const values = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return asUtc - date.getTime();
}

function applyAtTimeInZone(date: Date, hhmm: string, timeZone: string) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "").trim());
  if (!m) return date;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const parts = getZonedParts(date, timeZone);
  const guessUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hours, minutes, 0, 0);
  const firstPass = new Date(guessUtcMs - getTimeZoneOffsetMs(new Date(guessUtcMs), timeZone));
  const finalOffset = getTimeZoneOffsetMs(firstPass, timeZone);
  return new Date(guessUtcMs - finalOffset);
}

function filterRulesByPaymentType<T extends { conditions?: { requirePaymentTypeIn?: string[] } }>(rules: T[], paymentType?: string | null) {
  const normalized = String(paymentType || "").trim().toUpperCase();
  return rules.filter((rule) => {
    const required = Array.isArray(rule.conditions?.requirePaymentTypeIn) ? rule.conditions?.requirePaymentTypeIn : [];
    if (!required?.length) return true;
    if (!normalized) return false;
    return required.includes(normalized);
  });
}

async function resolveScheduledRunAt(args: { base: Date; atTime?: string | null }) {
  const atTime = String(args.atTime || "").trim();
  if (!atTime) return args.base;
  const timeZone = await getAppTimeZone().catch(() => "America/Bogota");
  return applyAtTimeInZone(args.base, atTime, timeZone);
}

export async function scheduleSubscriptionDueNotifications(args: { subscriptionId: string; forceNow?: boolean; actor?: string }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { scheduled: 0 };

  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      customerId: true
    }
  });
  if (!sub) return { scheduled: 0 };

  const billingState = await resolveSubscriptionBillingState({ subscriptionId: sub.id });
  const collectionCycle = billingState?.collectionCycle || null;
  if (!collectionCycle) return { scheduled: 0 };

  const cfg = await getNotificationsConfig();
  const rules = cfg.rules.filter((r) => r.enabled && r.trigger === "SUBSCRIPTION_DUE");
  if (!rules.length) {
    return { scheduled: 0 };
  }

  const now = new Date();
  const anchorAt = new Date(collectionCycle.dueAt || collectionCycle.periodEndAt);
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  for (const rule of rules) {
    const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
    const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
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
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.SUBSCRIPTION_REMINDER,
          runAt,
          payload: {
            trigger: "SUBSCRIPTION_DUE" satisfies NotificationTrigger,
            ruleId: rule.id,
            offsetSeconds,
            subscriptionId: sub.id,
            customerId: sub.customerId,
            cycleNumber: collectionCycle.cycleNumber,
            anchorAt: anchorIso
          }
        }
      });
      scheduled++;
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
      scheduled
    },
    args.actor || SystemActor.JOB_SUBSCRIPTION_REMINDER
  ).catch((err) => {
    logger.warn({ err, subscriptionId: sub.id }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled };
}

export async function schedulePaymentStatusNotifications(args: { paymentId: string; forceNow?: boolean; actor?: string }) {
  const paymentId = String(args.paymentId || "").trim();
  if (!paymentId) return { scheduled: 0 };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, customerId: true, subscriptionId: true, status: true, providerResponse: true, reference: true }
  });
  if (!payment) return { scheduled: 0 };

  const paymentsCfg = await getPaymentsConfig().catch(() => null);
  const reconciliationStatus = (() => {
    const resp: any = payment.providerResponse && typeof payment.providerResponse === "object" ? (payment.providerResponse as any) : null;
    return String(resp?.reconciliation?.status || "").toUpperCase();
  })();
  if (reconciliationStatus === "IGNORED_EXTERNAL") return { scheduled: 0 };
  if (!payment.subscriptionId && paymentsCfg && paymentsCfg.notifyWhatsappForUnlinkedPayments === false) return { scheduled: 0 };

  const referenceInfo = classifyReference(payment.reference);
  const isInternalRef = referenceInfo.kind === "subscription" || referenceInfo.kind === "order";
  const isShopifyRef = referenceInfo.kind === "shopify";
  if (!payment.subscriptionId && !isInternalRef) return { scheduled: 0 };
  if (isShopifyRef) return { scheduled: 0 };

  const trigger: NotificationTrigger | null =
    payment.status === PaymentStatus.APPROVED ? "PAYMENT_APPROVED" : payment.status === PaymentStatus.DECLINED ? "PAYMENT_DECLINED" : null;
  if (!trigger) return { scheduled: 0 };

  const cfg = await getNotificationsConfig();
  const billingState = payment.subscriptionId ? await resolveSubscriptionBillingState({ subscriptionId: payment.subscriptionId }).catch(() => null) : null;
  const paymentType =
    billingState?.subscription?.plan?.metadata?.collectionMode === "AUTO_LINK"
      ? "LINK"
      : payment.subscriptionId
        ? "SUBSCRIPTION"
        : "LINK";
  const rules = filterRulesByPaymentType(
    cfg.rules.filter((r) => r.enabled && r.trigger === trigger),
    paymentType
  );
  if (!rules.length) {
    return { scheduled: 0 };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  for (const rule of rules) {
    const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
    const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const jobPayload = {
        trigger,
        ruleId: rule.id,
        offsetSeconds,
        paymentId: payment.id,
        customerId: payment.customerId,
        subscriptionId: payment.subscriptionId,
        paymentStatus: payment.status,
        anchorAt: anchorIso
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await prisma.retryJob.create({
          data: {
            type: RetryJobType.SUBSCRIPTION_REMINDER,
            runAt,
            payload: jobPayload
          }
        });
        scheduled++;
      } else {
        await subscriptionReminder(jobPayload).catch((err) => {
          logger.warn({ err, paymentId, trigger }, '[Notifications/Schedule] Fallo en envío inline de payment status');
        });
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
      scheduled
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled };
}

export async function schedulePaymentLinkNotifications(args: { paymentId: string; forceNow?: boolean; actor?: string }) {
  const paymentId = String(args.paymentId || "").trim();
  if (!paymentId) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, customerId: true, subscriptionId: true }
  });
  if (!payment) return { scheduled: 0, sentNow: 0, rulesActive: false, errors: [] as string[] };

  const cfg = await getNotificationsConfig();
  const rules = filterRulesByPaymentType(
    cfg.rules.filter((r) => r.enabled && r.trigger === "PAYMENT_LINK_CREATED"),
    "LINK"
  );
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
      const jobPayload = {
        trigger: "PAYMENT_LINK_CREATED" satisfies NotificationTrigger,
        ruleId: rule.id,
        offsetSeconds,
        paymentId: payment.id,
        customerId: payment.customerId,
        ...(payment.subscriptionId ? { subscriptionId: payment.subscriptionId } : {}),
        anchorAt: anchorIso,
        ...(args.forceNow ? { immediateSend: true } : {})
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await prisma.retryJob.create({
          data: {
            type: RetryJobType.SUBSCRIPTION_REMINDER,
            runAt,
            payload: jobPayload
          }
        });
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

  await systemLog(
    LogLevel.INFO,
    "notifications.schedule",
    args.forceNow ? "Notificaciones enviadas" : "Notificaciones programadas",
    {
      trigger: "PAYMENT_LINK_CREATED",
      environment: await getNotificationsActiveEnv(),
      paymentId: payment.id,
      customerId: payment.customerId,
      scheduled
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, paymentId }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled, sentNow, rulesActive: true, errors };
}

export async function scheduleCatalogLinkNotifications(args: { customerId: string; catalogUrl: string; forceNow?: boolean; paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK" | ""; actor?: string }) {
  const customerId = String(args.customerId || "").trim();
  const catalogUrl = String(args.catalogUrl || "").trim();
  if (!customerId || !catalogUrl) return { scheduled: 0, sentNow: 0, rulesActive: false };

  const cfg = await getNotificationsConfig();
  const rules = filterRulesByPaymentType(
    cfg.rules.filter((r) => r.enabled && r.trigger === "CATALOG_LINK_CREATED"),
    args.paymentType || undefined
  );
  if (!rules.length) {
    return { scheduled: 0, sentNow: 0, rulesActive: false };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();
  let scheduled = 0;
  let sentNow = 0;

  for (const rule of rules) {
    const offsetsSeconds = resolveOffsetsSeconds(rule as NotificationRule);
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const jobPayload = {
        trigger: "CATALOG_LINK_CREATED" satisfies NotificationTrigger,
        ruleId: rule.id,
        offsetSeconds,
        customerId,
        catalogUrl,
        anchorAt: anchorIso,
        immediateSend: args.forceNow,
        ...(args.paymentType ? { paymentType: args.paymentType } : {})
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await prisma.retryJob.create({
          data: {
            type: RetryJobType.SUBSCRIPTION_REMINDER,
            runAt,
            payload: jobPayload
          }
        });
        scheduled++;
      } else {
        const result = await subscriptionReminder(jobPayload).catch((err) => {
          logger.warn({ err, customerId }, '[Notifications/Schedule] Fallo en envío inline de catalog link');
          return { ok: false } as const;
        });
        if (result && "ok" in result && result.ok) sentNow++;
      }
    }
  }

  await systemLog(
    LogLevel.INFO,
    "notifications.schedule",
    args.forceNow ? "Notificaciones enviadas" : "Notificaciones programadas",
    {
      trigger: "CATALOG_LINK_CREATED",
      environment: await getNotificationsActiveEnv(),
      customerId,
      scheduled
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, customerId }, '[Notifications/Schedule] Fallo creando systemLog');
  });

  return { scheduled, sentNow, rulesActive: true };
}

export async function scheduleTokenizationLinkNotifications(args: { customerId: string; tokenUrl: string; forceNow?: boolean; actor?: string }) {
  const customerId = String(args.customerId || "").trim();
  const tokenUrl = String(args.tokenUrl || "").trim();
  if (!customerId || !tokenUrl) return { scheduled: 0, sentNow: 0, rulesActive: false };

  const cfg = await getNotificationsConfig();
  const rules = filterRulesByPaymentType(
    cfg.rules.filter((r) => r.enabled && r.trigger === "TOKENIZATION_LINK_CREATED"),
    "SUBSCRIPTION"
  );
  if (!rules.length) {
    return { scheduled: 0, sentNow: 0, rulesActive: false };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();
  let scheduled = 0;
  let sentNow = 0;

  for (const rule of rules) {
    const offsetsSecondsBase = resolveOffsetsSeconds(rule as NotificationRule);
    const offsetsSeconds = args.forceNow ? [0] : offsetsSecondsBase;
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = await resolveScheduledRunAt({ base: runAtBase, atTime: rule.atTimeUtc });
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      const jobPayload = {
        trigger: "TOKENIZATION_LINK_CREATED" satisfies NotificationTrigger,
        ruleId: rule.id,
        offsetSeconds,
        customerId,
        tokenUrl,
        anchorAt: anchorIso,
        immediateSend: args.forceNow
      };
      if (!args.forceNow && runAt.getTime() > now.getTime()) {
        await prisma.retryJob.create({
          data: {
            type: RetryJobType.SUBSCRIPTION_REMINDER,
            runAt,
            payload: jobPayload
          }
        });
        scheduled++;
      } else {
        const result = await subscriptionReminder(jobPayload).catch((err) => {
          logger.warn({ err, customerId, trigger: "TOKENIZATION_LINK_CREATED" }, "[Notifications/Schedule] Fallo en envío inline de tokenización");
          return { ok: false } as const;
        });
        if (result && "ok" in result && result.ok) sentNow++;
      }
    }
  }

  await systemLog(
    LogLevel.INFO,
    "notifications.schedule",
    args.forceNow ? "Notificaciones enviadas" : "Notificaciones programadas",
    {
      trigger: "TOKENIZATION_LINK_CREATED",
      environment: await getNotificationsActiveEnv(),
      customerId,
      scheduled
    },
    args.actor || SystemActor.SYSTEM
  ).catch((err) => {
    logger.warn({ err, customerId }, "[Notifications/Schedule] Fallo creando systemLog de tokenización");
  });

  return { scheduled, sentNow, rulesActive: true };
}
