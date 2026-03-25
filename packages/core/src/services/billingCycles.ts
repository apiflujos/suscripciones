import { prisma } from "../db/prisma";
import { BillingCycleStatus, PlanIntervalUnit, PaymentAssociationReason, PaymentOrigin } from "@prisma/client";

type SubscriptionSeed = {
  id: string;
  currentCycle: number;
  currentPeriodStartAt: Date;
  currentPeriodEndAt: Date;
  plan: { intervalUnit: PlanIntervalUnit; intervalCount: number };
};

function daysInMonth(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function shiftIntervalUtc(date: Date, unit: PlanIntervalUnit, count: number): Date {
  const d = new Date(date.getTime());
  const c = Math.trunc(count || 0);
  if (unit === PlanIntervalUnit.DAY) {
    d.setUTCDate(d.getUTCDate() + c);
    return d;
  }
  if (unit === PlanIntervalUnit.WEEK) {
    d.setUTCDate(d.getUTCDate() + c * 7);
    return d;
  }
  if (unit === PlanIntervalUnit.MONTH) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const targetMonth = m + c;
    const targetYear = y + Math.floor(targetMonth / 12);
    const month0 = ((targetMonth % 12) + 12) % 12;
    const last = daysInMonth(targetYear, month0);
    d.setUTCFullYear(targetYear);
    d.setUTCDate(1);
    d.setUTCMonth(month0);
    d.setUTCDate(Math.min(day, last));
    return d;
  }
  // CUSTOM: treat as days.
  d.setUTCDate(d.getUTCDate() + c);
  return d;
}

export function buildBillingCyclesForSubscription(sub: SubscriptionSeed, cyclesBack = 12, cyclesForward = 2) {
  const unit = sub.plan.intervalUnit;
  const count = Math.max(1, Math.trunc(sub.plan.intervalCount || 1));
  const cycles: Array<{
    subscriptionId: string;
    cycleNumber: number;
    periodStartAt: Date;
    periodEndAt: Date;
    dueAt: Date;
    status: BillingCycleStatus;
  }> = [];
  for (let offset = -cyclesBack; offset <= cyclesForward; offset += 1) {
    const cycleNumber = sub.currentCycle + offset;
    if (cycleNumber <= 0) continue;
    const shift = offset * count;
    const periodStartAt = shiftIntervalUtc(sub.currentPeriodStartAt, unit, shift);
    const periodEndAt = shiftIntervalUtc(sub.currentPeriodEndAt, unit, shift);
    cycles.push({
      subscriptionId: sub.id,
      cycleNumber,
      periodStartAt,
      periodEndAt,
      dueAt: periodEndAt,
      status: BillingCycleStatus.PENDING
    });
  }
  return cycles;
}

export async function ensureBillingCyclesForSubscriptions(subs: SubscriptionSeed[], cyclesBack = 12, cyclesForward = 2) {
  if (!subs.length) return;
  const ops = subs.flatMap((sub) => {
    const cycles = buildBillingCyclesForSubscription(sub, cyclesBack, cyclesForward);
    return cycles.map((c) =>
      prisma.subscriptionBillingCycle.upsert({
        where: { subscriptionId_cycleNumber: { subscriptionId: c.subscriptionId, cycleNumber: c.cycleNumber } },
        create: {
          subscriptionId: c.subscriptionId,
          cycleNumber: c.cycleNumber,
          periodStartAt: c.periodStartAt,
          periodEndAt: c.periodEndAt,
          dueAt: c.dueAt,
          status: c.status
        },
        update: {
          periodStartAt: c.periodStartAt,
          periodEndAt: c.periodEndAt,
          dueAt: c.dueAt
        }
      })
    );
  });
  for (let i = 0; i < ops.length; i += 50) {
    const chunk = ops.slice(i, i + 50);
    await prisma.$transaction(chunk);
  }
}

export async function attachPaymentToCycle(args: {
  paymentId: string;
  subscriptionId: string;
  cycleId: string;
  paymentAt: Date;
  origin?: PaymentOrigin | null;
  associationReason?: PaymentAssociationReason | null;
  associatedBy?: string | null;
}) {
  const paymentAt = args.paymentAt;
  const cycle = await prisma.subscriptionBillingCycle.findUnique({ where: { id: args.cycleId } });
  if (!cycle) return { ok: false as const, error: "cycle_not_found" as const };
  if (cycle.subscriptionId !== args.subscriptionId) return { ok: false as const, error: "cycle_mismatch" as const };
  const dueAt = cycle.dueAt || cycle.periodEndAt;
  const msDiff = paymentAt.getTime() - dueAt.getTime();
  const daysLate = msDiff > 0 ? Math.ceil(msDiff / (24 * 60 * 60 * 1000)) : 0;
  const daysEarly = msDiff < 0 ? Math.ceil(Math.abs(msDiff) / (24 * 60 * 60 * 1000)) : 0;
  const paidOnTime = msDiff <= 0;

  await prisma.subscriptionBillingCycle.update({
    where: { id: args.cycleId },
    data: {
      paymentId: args.paymentId,
      paidAt: paymentAt,
      status: BillingCycleStatus.PAID,
      paidOnTime,
      daysEarly,
      daysLate,
      origin: args.origin || undefined,
      associationReason: args.associationReason || undefined,
      associatedBy: args.associatedBy || undefined
    }
  });
  return { ok: true as const };
}

export async function attachPaymentToMatchingCycle(args: {
  subscriptionId: string;
  paymentId: string;
  paymentAt: Date;
  origin?: PaymentOrigin | null;
  associationReason?: PaymentAssociationReason | null;
  associatedBy?: string | null;
  toleranceDays?: number;
}) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true }
  });
  if (!subscription) return { ok: false as const, error: "subscription_not_found" as const };

  await ensureBillingCyclesForSubscriptions([
    {
      id: subscription.id,
      currentCycle: subscription.currentCycle,
      currentPeriodStartAt: subscription.currentPeriodStartAt,
      currentPeriodEndAt: subscription.currentPeriodEndAt,
      plan: { intervalUnit: subscription.plan.intervalUnit, intervalCount: subscription.plan.intervalCount }
    }
  ]).catch(() => {});

  const toleranceDays = Number.isFinite(args.toleranceDays) ? Math.max(0, Math.trunc(args.toleranceDays!)) : 7;
  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
  const paymentAt = args.paymentAt;

  const cycles = await prisma.subscriptionBillingCycle.findMany({
    where: { subscriptionId: subscription.id },
    orderBy: { periodStartAt: "desc" }
  });
  const match = cycles.find((c) => {
    const start = new Date(c.periodStartAt).getTime() - toleranceMs;
    const end = new Date(c.periodEndAt).getTime() + toleranceMs;
    const ts = paymentAt.getTime();
    return ts >= start && ts <= end;
  });
  if (!match) return { ok: false as const, error: "cycle_not_found" as const };

  return attachPaymentToCycle({
    paymentId: args.paymentId,
    subscriptionId: subscription.id,
    cycleId: match.id,
    paymentAt,
    origin: args.origin,
    associationReason: args.associationReason,
    associatedBy: args.associatedBy
  });
}
