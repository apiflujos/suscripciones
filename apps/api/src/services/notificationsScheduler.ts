import { LogLevel, PaymentStatus, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getNotificationsActiveEnv, getNotificationsConfig, NotificationTrigger } from "./notificationsConfig";
import { LogLevel } from "@prisma/client";
import { systemLog } from "./systemLog";

function toMsSeconds(seconds: number) {
  return seconds * 1000;
}

function clampRunAt(runAt: Date, now: Date) {
  return runAt.getTime() < now.getTime() ? now : runAt;
}

function applyAtTimeUtc(date: Date, hhmm: string) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "").trim());
  if (!m) return date;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const d = new Date(date.getTime());
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
}

export async function scheduleSubscriptionDueNotifications(args: { subscriptionId: string; forceNow?: boolean }) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return { scheduled: 0 };

  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      customerId: true,
      currentCycle: true,
      currentPeriodEndAt: true
    }
  });
  if (!sub) return { scheduled: 0 };

  const cfg = await getNotificationsConfig();
  const rules = cfg.rules.filter((r) => r.enabled && r.trigger === "SUBSCRIPTION_DUE");
  if (!rules.length) {
    const env = await getNotificationsActiveEnv();
    await systemLog(LogLevel.WARN, "notifications.schedule", "No hay reglas activas para notificaciones", {
      trigger: "SUBSCRIPTION_DUE",
      environment: env,
      subscriptionId: sub.id
    }).catch(() => {});
    return { scheduled: 0 };
  }

  const now = new Date();
  const anchorAt = sub.currentPeriodEndAt;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  for (const rule of rules) {
    const offsetsSeconds = (rule as any).offsetsSeconds?.length
      ? (rule as any).offsetsSeconds
      : ((rule as any).offsetsMinutes?.length ? (rule as any).offsetsMinutes.map((m: number) => m * 60) : [0]);
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = (rule as any).atTimeUtc ? applyAtTimeUtc(runAtBase, String((rule as any).atTimeUtc)) : runAtBase;
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
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
            cycleNumber: sub.currentCycle,
            anchorAt: anchorIso
          } as any
        }
      });
      scheduled++;
    }
  }

  return { scheduled };
}

export async function schedulePaymentStatusNotifications(args: { paymentId: string; forceNow?: boolean }) {
  const paymentId = String(args.paymentId || "").trim();
  if (!paymentId) return { scheduled: 0 };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, customerId: true, subscriptionId: true, status: true }
  });
  if (!payment) return { scheduled: 0 };

  const trigger: NotificationTrigger | null =
    payment.status === PaymentStatus.APPROVED ? "PAYMENT_APPROVED" : payment.status === PaymentStatus.DECLINED ? "PAYMENT_DECLINED" : null;
  if (!trigger) return { scheduled: 0 };

  const cfg = await getNotificationsConfig();
  const rules = cfg.rules.filter((r) => r.enabled && r.trigger === trigger);
  if (!rules.length) {
    const env = await getNotificationsActiveEnv();
    await systemLog(LogLevel.WARN, "notifications.schedule", "No hay reglas activas para notificaciones", {
      trigger,
      environment: env,
      paymentId: payment.id
    }).catch(() => {});
    return { scheduled: 0 };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  for (const rule of rules) {
    const offsetsSeconds = (rule as any).offsetsSeconds?.length
      ? (rule as any).offsetsSeconds
      : ((rule as any).offsetsMinutes?.length ? (rule as any).offsetsMinutes.map((m: number) => m * 60) : [0]);
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = (rule as any).atTimeUtc ? applyAtTimeUtc(runAtBase, String((rule as any).atTimeUtc)) : runAtBase;
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.SUBSCRIPTION_REMINDER,
          runAt,
          payload: {
            trigger,
            ruleId: rule.id,
            offsetSeconds,
            paymentId: payment.id,
            customerId: payment.customerId,
            subscriptionId: payment.subscriptionId,
            paymentStatus: payment.status,
            anchorAt: anchorIso
          } as any
        }
      });
      scheduled++;
    }
  }

  return { scheduled };
}

export async function schedulePaymentLinkNotifications(args: { paymentId: string; forceNow?: boolean }) {
  const paymentId = String(args.paymentId || "").trim();
  if (!paymentId) return { scheduled: 0 };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, customerId: true, subscriptionId: true }
  });
  if (!payment) return { scheduled: 0 };

  const cfg = await getNotificationsConfig();
  const rules = cfg.rules.filter((r) => r.enabled && r.trigger === "PAYMENT_LINK_CREATED");
  if (!rules.length) {
    const env = await getNotificationsActiveEnv();
    await systemLog(LogLevel.WARN, "notifications.schedule", "No hay reglas activas para notificaciones", {
      trigger: "PAYMENT_LINK_CREATED",
      environment: env,
      paymentId: payment.id,
      customerId: payment.customerId
    }).catch(() => {});
    return { scheduled: 0 };
  }

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  for (const rule of rules) {
    const offsetsSeconds = (rule as any).offsetsSeconds?.length
      ? (rule as any).offsetsSeconds
      : ((rule as any).offsetsMinutes?.length ? (rule as any).offsetsMinutes.map((m: number) => m * 60) : [0]);
    for (const offsetSeconds of offsetsSeconds) {
      const runAtBase = new Date(anchorAt.getTime() + toMsSeconds(offsetSeconds));
      const runAtRaw = (rule as any).atTimeUtc ? applyAtTimeUtc(runAtBase, String((rule as any).atTimeUtc)) : runAtBase;
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.SUBSCRIPTION_REMINDER,
          runAt,
          payload: {
            trigger: "PAYMENT_LINK_CREATED" satisfies NotificationTrigger,
            ruleId: rule.id,
            offsetSeconds,
            paymentId: payment.id,
            customerId: payment.customerId,
            subscriptionId: payment.subscriptionId ?? null,
            anchorAt: anchorIso
          } as any
        }
      });
      scheduled++;
    }
  }

  return { scheduled };
}
