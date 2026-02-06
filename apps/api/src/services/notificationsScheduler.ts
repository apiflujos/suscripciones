import { PaymentStatus, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getNotificationsConfig, NotificationTrigger } from "./notificationsConfig";

function toMsMinutes(minutes: number) {
  return minutes * 60_000;
}

function clampRunAt(runAt: Date, now: Date) {
  return runAt.getTime() < now.getTime() ? now : runAt;
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
  if (!rules.length) return { scheduled: 0 };

  const now = new Date();
  const anchorAt = sub.currentPeriodEndAt;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  for (const rule of rules) {
    for (const offset of rule.offsetsMinutes || []) {
      const runAtRaw = new Date(anchorAt.getTime() + toMsMinutes(offset));
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.SUBSCRIPTION_REMINDER,
          runAt,
          payload: {
            trigger: "SUBSCRIPTION_DUE" satisfies NotificationTrigger,
            ruleId: rule.id,
            offsetMinutes: offset,
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
  if (!payment.subscriptionId) return { scheduled: 0 };

  const trigger: NotificationTrigger | null =
    payment.status === PaymentStatus.APPROVED ? "PAYMENT_APPROVED" : payment.status === PaymentStatus.DECLINED ? "PAYMENT_DECLINED" : null;
  if (!trigger) return { scheduled: 0 };

  const cfg = await getNotificationsConfig();
  const rules = cfg.rules.filter((r) => r.enabled && r.trigger === trigger);
  if (!rules.length) return { scheduled: 0 };

  const now = new Date();
  const anchorAt = now;
  const anchorIso = anchorAt.toISOString();

  let scheduled = 0;
  for (const rule of rules) {
    for (const offset of rule.offsetsMinutes || []) {
      const runAtRaw = new Date(anchorAt.getTime() + toMsMinutes(offset));
      const runAt = args.forceNow ? clampRunAt(runAtRaw, now) : runAtRaw;
      await prisma.retryJob.create({
        data: {
          type: RetryJobType.SUBSCRIPTION_REMINDER,
          runAt,
          payload: {
            trigger,
            ruleId: rule.id,
            offsetMinutes: offset,
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
