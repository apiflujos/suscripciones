import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { BillingCycleStatus, PlanIntervalUnit, PaymentAssociationReason, PaymentOrigin } from "@prisma/client";

type SubscriptionSeed = {
  id: string;
  currentCycle: number;
  currentPeriodStartAt: Date;
  currentPeriodEndAt: Date;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: "EN_CURSO" | "ANTICIPADO";
  graceDays: number;
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

function clampDay(year: number, month0: number, day: number) {
  const last = daysInMonth(year, month0);
  return Math.max(1, Math.min(day, last));
}

function setDayInMonth(base: Date, day: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = clampDay(y, m, day);
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}

function monthShift(date: Date, delta: number) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const targetMonth = m + delta;
  const targetYear = y + Math.floor(targetMonth / 12);
  const month0 = ((targetMonth % 12) + 12) % 12;
  return { year: targetYear, month0 };
}

function dateForDayInMonth(year: number, month0: number, day: number) {
  const d = clampDay(year, month0, day);
  return new Date(Date.UTC(year, month0, d, 0, 0, 0, 0));
}

function resolveCycleStartAnchor(sub: SubscriptionSeed) {
  const base = new Date(sub.currentPeriodStartAt);
  const day = Math.max(1, Math.min(31, Math.trunc(sub.cycleStartDay || 1)));
  const candidate = setDayInMonth(base, day);
  if (candidate.getTime() <= base.getTime()) return candidate;
  const prev = shiftIntervalUtc(candidate, PlanIntervalUnit.MONTH, -1);
  return prev;
}

export function computeBillingCycleDueAt(params: {
  periodStartAt: Date;
  periodEndAt: Date;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: "EN_CURSO" | "ANTICIPADO";
}) {
  const cycleStartDay = Math.max(1, Math.min(31, Math.trunc(params.cycleStartDay || 1)));
  const paymentDay = Math.max(1, Math.min(31, Math.trunc(params.paymentDay || 1)));
  const timing = params.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
  const start = params.periodStartAt;
  if (timing === "ANTICIPADO") {
    const { year, month0 } = monthShift(start, -1);
    return dateForDayInMonth(year, month0, paymentDay);
  }
  const startMonth = start.getUTCMonth();
  const startYear = start.getUTCFullYear();
  if (paymentDay >= cycleStartDay) {
    return dateForDayInMonth(startYear, startMonth, paymentDay);
  }
  const { year, month0 } = monthShift(start, 1);
  return dateForDayInMonth(year, month0, paymentDay);
}

export function buildBillingCyclesForSubscription(sub: SubscriptionSeed, cyclesBack = 12, cyclesForward = 2) {
  const unit = sub.plan.intervalUnit;
  const count = Math.max(1, Math.trunc(sub.plan.intervalCount || 1));
  const anchorStart = unit === PlanIntervalUnit.MONTH ? resolveCycleStartAnchor(sub) : new Date(sub.currentPeriodStartAt);
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
    const periodStartAt = shiftIntervalUtc(anchorStart, unit, shift);
    const periodEndAt = shiftIntervalUtc(periodStartAt, unit, count);
    const dueAt =
      unit === PlanIntervalUnit.MONTH
        ? computeBillingCycleDueAt({
            periodStartAt,
            periodEndAt,
            cycleStartDay: sub.cycleStartDay,
            paymentDay: sub.paymentDay,
            paymentTiming: sub.paymentTiming
          })
        : periodEndAt;
    cycles.push({
      subscriptionId: sub.id,
      cycleNumber,
      periodStartAt,
      periodEndAt,
      dueAt,
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
  const cycle = await prisma.subscriptionBillingCycle.findUnique({
    where: { id: args.cycleId },
    include: { subscription: { select: { graceDays: true } } }
  });
  if (!cycle) return { ok: false as const, error: "cycle_not_found" as const };
  if (cycle.subscriptionId !== args.subscriptionId) return { ok: false as const, error: "cycle_mismatch" as const };
  const dueAt = cycle.dueAt || cycle.periodEndAt;
  const graceDays = Number.isFinite(cycle.subscription?.graceDays as any) ? Math.max(0, Number(cycle.subscription?.graceDays || 0)) : 0;
  const dueWithGrace = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const msDiff = paymentAt.getTime() - dueWithGrace.getTime();
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

export function findBestBillingCycleForPayment(args: {
  cycles: Array<{
    id: string;
    cycleNumber: number;
    periodStartAt: Date;
    periodEndAt: Date;
    dueAt: Date;
    paymentId?: string | null;
    status?: BillingCycleStatus | string | null;
  }>;
  paymentAt: Date;
  cycleNumberHint?: number | null;
  toleranceDays?: number;
}) {
  const toleranceDays = Number.isFinite(args.toleranceDays) ? Math.max(0, Math.trunc(args.toleranceDays!)) : 7;
  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
  const paymentTs = args.paymentAt.getTime();
  const unpaidCycles = args.cycles
    .filter((cycle) => !cycle.paymentId && String(cycle.status || "").toUpperCase() !== "PAID")
    .map((cycle) => ({
      ...cycle,
      periodStartMs: new Date(cycle.periodStartAt).getTime(),
      periodEndMs: new Date(cycle.periodEndAt).getTime(),
      dueAtMs: new Date(cycle.dueAt || cycle.periodEndAt).getTime()
    }));

  if (!unpaidCycles.length) return null;

  if (args.cycleNumberHint != null) {
    const direct = unpaidCycles.find((cycle) => cycle.cycleNumber === args.cycleNumberHint);
    if (direct) return direct;
  }

  const overdue = unpaidCycles.filter((cycle) => cycle.dueAtMs <= paymentTs);
  if (overdue.length) {
    overdue.sort((a, b) => a.dueAtMs - b.dueAtMs || a.cycleNumber - b.cycleNumber);
    return overdue[0];
  }

  const withinWindow = unpaidCycles.filter((cycle) => {
    const start = cycle.periodStartMs - toleranceMs;
    const end = cycle.periodEndMs + toleranceMs;
    return paymentTs >= start && paymentTs <= end;
  });
  if (withinWindow.length) {
    withinWindow.sort((a, b) => a.dueAtMs - b.dueAtMs || a.cycleNumber - b.cycleNumber);
    return withinWindow[0];
  }

  const nearestFuture = unpaidCycles
    .filter((cycle) => cycle.dueAtMs > paymentTs)
    .sort((a, b) => a.dueAtMs - b.dueAtMs || a.cycleNumber - b.cycleNumber);
  if (nearestFuture.length) return nearestFuture[0];

  unpaidCycles.sort((a, b) => a.dueAtMs - b.dueAtMs || a.cycleNumber - b.cycleNumber);
  return unpaidCycles[0];
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
      cycleStartDay: subscription.cycleStartDay,
      paymentDay: subscription.paymentDay,
      paymentTiming: (subscription.paymentTiming as any) || "EN_CURSO",
      graceDays: subscription.graceDays,
      plan: { intervalUnit: subscription.plan.intervalUnit, intervalCount: subscription.plan.intervalCount }
    }
  ]).catch((err) => {
    logger.warn({ err, subscriptionId: subscription.id }, "billingCycles: fallo asegurando ciclos antes de match");
  });

  const toleranceDays = Number.isFinite(args.toleranceDays) ? Math.max(0, Math.trunc(args.toleranceDays!)) : 7;

  const cycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId: subscription.id,
      paymentId: null,
      status: { not: BillingCycleStatus.PAID }
    },
    orderBy: [{ dueAt: "asc" }, { cycleNumber: "asc" }]
  });
  const match = findBestBillingCycleForPayment({
    cycles,
    paymentAt: args.paymentAt,
    toleranceDays
  });
  if (!match) return { ok: false as const, error: "cycle_not_found" as const };

  return attachPaymentToCycle({
    paymentId: args.paymentId,
    subscriptionId: subscription.id,
    cycleId: match.id,
    paymentAt: args.paymentAt,
    origin: args.origin,
    associationReason: args.associationReason,
    associatedBy: args.associatedBy
  });
}
