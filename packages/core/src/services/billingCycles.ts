import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { BillingCycleStatus, PlanIntervalUnit, PaymentAssociationReason, PaymentOrigin } from "@prisma/client";
import { getAutoDebitConfig } from "./runtimeConfig";
import { applyClockTimeInZone } from "../lib/timeZoneScheduling";

type SubscriptionSeed = {
  id: string;
  startAt?: Date | null;
  currentCycle?: number | null;
  currentPeriodStartAt?: Date | null;
  currentPeriodEndAt?: Date | null;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: "EN_CURSO" | "ANTICIPADO";
  graceDays: number;
  plan: { intervalUnit: PlanIntervalUnit; intervalCount: number };
};

export function buildSubscriptionSeed(input: {
  id: string;
  startAt?: Date | null;
  currentCycle?: number | null;
  currentPeriodStartAt?: Date | null;
  currentPeriodEndAt?: Date | null;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming?: string | null;
  graceDays: number;
  plan: { intervalUnit: PlanIntervalUnit; intervalCount: number };
}): SubscriptionSeed {
  return {
    id: input.id,
    startAt: input.startAt ?? null,
    currentCycle: input.currentCycle ?? null,
    currentPeriodStartAt: input.currentPeriodStartAt ?? null,
    currentPeriodEndAt: input.currentPeriodEndAt ?? null,
    cycleStartDay: input.cycleStartDay,
    paymentDay: input.paymentDay,
    paymentTiming: input.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO",
    graceDays: input.graceDays,
    plan: {
      intervalUnit: input.plan.intervalUnit,
      intervalCount: input.plan.intervalCount
    }
  };
}

export type BillingCycleLike = {
  id?: string;
  subscriptionId?: string;
  cycleNumber: number;
  periodStartAt: Date;
  periodEndAt: Date;
  dueAt: Date;
  paymentId?: string | null;
  status?: BillingCycleStatus | string | null;
};

export type ResolvedBillingState = {
  activeCycle: BillingCycleLike | null;
  collectionCycle: BillingCycleLike | null;
  oldestUnpaidCycle: BillingCycleLike | null;
};

export type CollectionDelinquencyStatus = "AL_DIA" | "EN_GRACIA" | "EN_MORA";

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
  const base = sub.currentPeriodStartAt ? new Date(sub.currentPeriodStartAt) : resolveCycleAnchorFromStart(sub);
  const day = Math.max(1, Math.min(31, Math.trunc(sub.cycleStartDay || 1)));
  const candidate = setDayInMonth(base, day);
  if (candidate.getTime() <= base.getTime()) return candidate;
  const prev = shiftIntervalUtc(candidate, PlanIntervalUnit.MONTH, -1);
  return prev;
}

function resolveCycleAnchorFromStart(sub: SubscriptionSeed) {
  const base = sub.startAt ? new Date(sub.startAt) : sub.currentPeriodStartAt ? new Date(sub.currentPeriodStartAt) : new Date();
  if (sub.plan.intervalUnit !== PlanIntervalUnit.MONTH) return base;
  const day = Math.max(1, Math.min(31, Math.trunc(sub.cycleStartDay || 1)));
  const candidate = setDayInMonth(base, day);
  if (candidate.getTime() <= base.getTime()) return candidate;
  return shiftIntervalUtc(candidate, PlanIntervalUnit.MONTH, -1);
}

function countElapsedIntervals(args: {
  startAt: Date;
  endAt: Date;
  unit: PlanIntervalUnit;
  count: number;
}) {
  const startAt = new Date(args.startAt);
  const endAt = new Date(args.endAt);
  const count = Math.max(1, Math.trunc(args.count || 1));
  if (endAt.getTime() <= startAt.getTime()) return 0;

  if (args.unit === PlanIntervalUnit.DAY || args.unit === PlanIntervalUnit.WEEK) {
    const stepDays = args.unit === PlanIntervalUnit.WEEK ? count * 7 : count;
    const stepMs = stepDays * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.floor((endAt.getTime() - startAt.getTime()) / stepMs));
  }

  let steps = 0;
  const monthsDiff =
    (endAt.getUTCFullYear() - startAt.getUTCFullYear()) * 12 +
    (endAt.getUTCMonth() - startAt.getUTCMonth());
  if (monthsDiff > 0) {
    steps = Math.floor(monthsDiff / count);
  }

  while (steps > 0) {
    const candidate = shiftIntervalUtc(startAt, args.unit, steps * count);
    if (candidate.getTime() <= endAt.getTime()) break;
    steps -= 1;
  }
  while (true) {
    const nextCandidate = shiftIntervalUtc(startAt, args.unit, (steps + 1) * count);
    if (nextCandidate.getTime() > endAt.getTime()) break;
    steps += 1;
  }

  return Math.max(0, steps);
}

export function normalizeSubscriptionSeed(sub: SubscriptionSeed): SubscriptionSeed {
  const unit = sub.plan.intervalUnit;
  const count = Math.max(1, Math.trunc(sub.plan.intervalCount || 1));
  const anchorStart = resolveCycleAnchorFromStart(sub);
  const referenceAt = sub.currentPeriodStartAt ? new Date(sub.currentPeriodStartAt) : new Date();
  const inferredCycle = countElapsedIntervals({
    startAt: anchorStart,
    endAt: referenceAt,
    unit,
    count
  }) + 1;
  const currentCycle = Math.max(1, Math.max(Math.trunc(sub.currentCycle || 1), inferredCycle));
  const currentPeriodStartAt = sub.currentPeriodStartAt
    ? new Date(sub.currentPeriodStartAt)
    : shiftIntervalUtc(anchorStart, unit, (currentCycle - 1) * count);
  const currentPeriodEndAt = sub.currentPeriodEndAt
    ? new Date(sub.currentPeriodEndAt)
    : shiftIntervalUtc(currentPeriodStartAt, unit, count);

  return {
    ...sub,
    currentCycle,
    currentPeriodStartAt,
    currentPeriodEndAt
  };
}

export function resolveConfiguredCollectionCycle(args: {
  cycles: BillingCycleLike[];
  asOf: Date;
  paymentTiming: "EN_CURSO" | "ANTICIPADO";
}) {
  const asOfTs = new Date(args.asOf).getTime();
  const unpaid = args.cycles
    .filter((cycle) => !isBillingCyclePaid(cycle))
    .sort((a, b) => a.cycleNumber - b.cycleNumber);
  if (!unpaid.length) return null;

  const current = unpaid.find((cycle) => {
    const startTs = new Date(cycle.periodStartAt).getTime();
    const endTs = new Date(cycle.periodEndAt).getTime();
    return startTs <= asOfTs && asOfTs < endTs;
  });

  if (args.paymentTiming === "ANTICIPADO") {
    const nextFuture = unpaid.find((cycle) => new Date(cycle.periodStartAt).getTime() > asOfTs);
    return nextFuture || current || unpaid[0];
  }

  // EN_CURSO: si hay ciclos cuyo dueAt ya pasó (mora), retornar el más antiguo.
  // Esto garantiza que un ciclo vencido de un período anterior tenga máxima prioridad
  // sobre el ciclo del período actual, aunque éste ya haya comenzado.
  const overdue = unpaid.filter((cycle) => {
    const dueTs = cycle.dueAt
      ? new Date(cycle.dueAt).getTime()
      : new Date(cycle.periodEndAt).getTime();
    return dueTs < asOfTs;
  });
  if (overdue.length > 0) return overdue[0];

  const latestOpen = [...unpaid]
    .filter((cycle) => new Date(cycle.periodStartAt).getTime() <= asOfTs)
    .sort((a, b) => new Date(b.periodStartAt).getTime() - new Date(a.periodStartAt).getTime())[0];
  return current || latestOpen || unpaid[0];
}

export function isBillingCyclePaid(cycle: { status?: BillingCycleStatus | string | null; paymentId?: string | null } | null | undefined) {
  if (!cycle) return false;
  return String(cycle.status || "").toUpperCase() === BillingCycleStatus.PAID;
}

export function resolveCollectionDelinquency(args: {
  cycle: BillingCycleLike | null | undefined;
  graceDays?: number | null;
  asOf?: Date;
  fallbackSubscriptionStatus?: string | null;
}) {
  const cycle = args.cycle || null;
  const asOf = args.asOf ? new Date(args.asOf) : new Date();
  const graceDays = Number.isFinite(Number(args.graceDays)) ? Math.max(0, Math.trunc(Number(args.graceDays))) : 0;

  if (isBillingCyclePaid(cycle)) {
    return {
      status: "AL_DIA" as const,
      dueAt: cycle?.dueAt ? new Date(cycle.dueAt) : cycle?.periodEndAt ? new Date(cycle.periodEndAt) : null,
      dueWithGraceAt: null,
      daysPastDue: 0
    };
  }

  const dueAt = cycle?.dueAt ? new Date(cycle.dueAt) : cycle?.periodEndAt ? new Date(cycle.periodEndAt) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) {
    const fallback = String(args.fallbackSubscriptionStatus || "").toUpperCase();
    return {
      status: fallback === "PAST_DUE" || fallback === "EXPIRED" ? ("EN_MORA" as const) : ("AL_DIA" as const),
      dueAt: null,
      dueWithGraceAt: null,
      daysPastDue: 0
    };
  }

  const dueAtTs = dueAt.getTime();
  const asOfTs = asOf.getTime();
  if (asOfTs <= dueAtTs) {
    return {
      status: "AL_DIA" as const,
      dueAt,
      dueWithGraceAt: new Date(dueAtTs + graceDays * 24 * 60 * 60 * 1000),
      daysPastDue: 0
    };
  }

  const daysPastDue = Math.ceil((asOfTs - dueAtTs) / (24 * 60 * 60 * 1000));
  const dueWithGraceAt = new Date(dueAtTs + graceDays * 24 * 60 * 60 * 1000);
  return {
    status: daysPastDue <= graceDays ? ("EN_GRACIA" as const) : ("EN_MORA" as const),
    dueAt,
    dueWithGraceAt,
    daysPastDue
  };
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
  const currentCycle = Math.max(1, Math.trunc(sub.currentCycle || 1));
  const currentPeriodStartAt = sub.currentPeriodStartAt ? new Date(sub.currentPeriodStartAt) : resolveCycleAnchorFromStart(sub);
  const anchorStart = unit === PlanIntervalUnit.MONTH ? resolveCycleStartAnchor({ ...sub, currentPeriodStartAt }) : currentPeriodStartAt;
  const cycles: Array<{
    subscriptionId: string;
    cycleNumber: number;
    periodStartAt: Date;
    periodEndAt: Date;
    dueAt: Date;
    status: BillingCycleStatus;
  }> = [];
  for (let offset = -cyclesBack; offset <= cyclesForward; offset += 1) {
    const cycleNumber = currentCycle + offset;
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

async function applyConfiguredExecutionSchedule<T extends { dueAt: Date }>(cycles: T[]) {
  if (!cycles.length) return cycles;
  const cfg = await getAutoDebitConfig().catch(() => null);
  const executionHour = String(cfg?.executionHour || "09:00").trim() || "09:00";
  const timeZone = String(cfg?.timeZone || "America/Bogota").trim() || "America/Bogota";
  return cycles.map((cycle) => ({
    ...cycle,
    dueAt: applyClockTimeInZone(new Date(cycle.dueAt), executionHour, timeZone)
  }));
}

function canRescheduleExistingCycle(cycle: BillingCycleLike | null | undefined, now: Date) {
  if (!cycle) return true;
  if (cycle.paymentId) return false;
  const status = String(cycle.status || "").trim().toUpperCase();
  if (status === "PAID" || status === "FAILED" || status === "SKIPPED") return false;
  return new Date(cycle.dueAt).getTime() >= now.getTime();
}

function pickAuthoritativeCycleSeed(args: {
  sub: SubscriptionSeed;
  existingCycles: BillingCycleLike[];
  asOf: Date;
}): SubscriptionSeed {
  if (!args.existingCycles.length) return normalizeSubscriptionSeed(args.sub);
  const activeCycle = resolveActiveCycle({ cycles: args.existingCycles, asOf: args.asOf });
  const latestCycle = [...args.existingCycles].sort((a, b) => b.cycleNumber - a.cycleNumber)[0] || null;
  const anchor = activeCycle || latestCycle;
  if (!anchor) return normalizeSubscriptionSeed(args.sub);
  return normalizeSubscriptionSeed({
    ...args.sub,
    currentCycle: anchor.cycleNumber,
    currentPeriodStartAt: new Date(anchor.periodStartAt),
    currentPeriodEndAt: new Date(anchor.periodEndAt)
  });
}

export async function ensureBillingCyclesForSubscriptions(subs: SubscriptionSeed[], cyclesBack = 12, cyclesForward = 2) {
  if (!subs.length) return;
  const uniqueSubs = Array.from(new Map(subs.map((sub) => [sub.id, sub])).values());
  const existingCycles = await prisma.subscriptionBillingCycle.findMany({
    where: { subscriptionId: { in: uniqueSubs.map((sub) => sub.id) } },
    orderBy: [{ subscriptionId: "asc" }, { cycleNumber: "asc" }]
  });
  const existingCyclesBySubscription = new Map<string, BillingCycleLike[]>();
  for (const cycle of existingCycles) {
    const list = existingCyclesBySubscription.get(cycle.subscriptionId) || [];
    list.push(cycle);
    existingCyclesBySubscription.set(cycle.subscriptionId, list);
  }

  const prepared = await Promise.all(uniqueSubs.map(async (rawSub) => {
    const now = new Date();
    const sub = pickAuthoritativeCycleSeed({
      sub: rawSub,
      existingCycles: existingCyclesBySubscription.get(rawSub.id) || [],
      asOf: new Date()
    });
    const safeCyclesBack = Math.max(cyclesBack, Math.max(1, Math.trunc(sub.currentCycle || 1)) - 1);
    const cycles = await applyConfiguredExecutionSchedule(buildBillingCyclesForSubscription(sub, safeCyclesBack, cyclesForward));
    const existingByCycle = new Map(
      (existingCyclesBySubscription.get(rawSub.id) || []).map((cycle) => [cycle.cycleNumber, cycle] as const)
    );
    return cycles.map((c) =>
      {
        const existing = existingByCycle.get(c.cycleNumber) || null;
        const keepExisting = existing && !canRescheduleExistingCycle(existing, now);
        const nextPeriodStartAt = keepExisting ? new Date(existing.periodStartAt) : c.periodStartAt;
        const nextPeriodEndAt = keepExisting ? new Date(existing.periodEndAt) : c.periodEndAt;
        const nextDueAt = keepExisting ? new Date(existing.dueAt) : c.dueAt;
        return (
      prisma.subscriptionBillingCycle.upsert({
        where: { subscriptionId_cycleNumber: { subscriptionId: c.subscriptionId, cycleNumber: c.cycleNumber } },
        create: {
          subscriptionId: c.subscriptionId,
          cycleNumber: c.cycleNumber,
          periodStartAt: nextPeriodStartAt,
          periodEndAt: nextPeriodEndAt,
          dueAt: nextDueAt,
          status: c.status
        },
        update: {
          periodStartAt: nextPeriodStartAt,
          periodEndAt: nextPeriodEndAt,
          dueAt: nextDueAt
        }
      })
        );
      }
    );
  }));
  const ops = prepared.flat();
  for (let i = 0; i < ops.length; i += 50) {
    const chunk = ops.slice(i, i + 50);
    await prisma.$transaction(chunk);
  }
}

export async function ensureBillingCyclesForSubscription(args: SubscriptionSeed, cyclesForward = 2) {
  const sub = normalizeSubscriptionSeed(args);
  await ensureBillingCyclesForSubscriptions([sub], Math.max(0, Math.max(1, Math.trunc(sub.currentCycle || 1)) - 1), cyclesForward);
  await syncSubscriptionBillingSnapshot({ subscriptionId: sub.id }).catch(() => null);
}

function resolveActiveCycle(args: {
  cycles: BillingCycleLike[];
  asOf: Date;
}) {
  const asOfTs = new Date(args.asOf).getTime();
  const sorted = [...args.cycles].sort((a, b) => a.cycleNumber - b.cycleNumber);
  const exact = sorted.find((cycle) => {
    const startTs = new Date(cycle.periodStartAt).getTime();
    const endTs = new Date(cycle.periodEndAt).getTime();
    return startTs <= asOfTs && asOfTs < endTs;
  });
  if (exact) return exact;

  const latestStarted = [...sorted]
    .filter((cycle) => new Date(cycle.periodStartAt).getTime() <= asOfTs)
    .sort((a, b) => b.cycleNumber - a.cycleNumber)[0];
  if (latestStarted) return latestStarted;

  return sorted[0] || null;
}

export function resolveBillingStateFromCycles(args: {
  cycles: BillingCycleLike[];
  asOf: Date;
  paymentTiming: "EN_CURSO" | "ANTICIPADO";
}): ResolvedBillingState {
  const activeCycle = resolveActiveCycle({ cycles: args.cycles, asOf: args.asOf });
  const collectionCycle = resolveConfiguredCollectionCycle({
    cycles: args.cycles,
    asOf: args.asOf,
    paymentTiming: args.paymentTiming
  });
  const oldestUnpaidCycle = args.cycles.find((cycle) => !isBillingCyclePaid(cycle)) || null;
  return {
    activeCycle,
    collectionCycle,
    oldestUnpaidCycle
  };
}

export async function buildSubscriptionBillingStateIndex(args: {
  subscriptions: SubscriptionSeed[];
  asOf?: Date;
  cyclesForward?: number;
  ensureCycles?: boolean;
}) {
  const subscriptions = args.subscriptions.map((sub) => normalizeSubscriptionSeed(sub));
  if (!subscriptions.length) return new Map<string, ResolvedBillingState>();

  const uniqueSubscriptions = Array.from(new Map(subscriptions.map((sub) => [sub.id, sub])).values());
  if (args.ensureCycles !== false) {
    await ensureBillingCyclesForSubscriptions(
      uniqueSubscriptions,
      Math.max(...uniqueSubscriptions.map((sub) => Math.max(0, Number(sub.currentCycle || 1) - 1)), 0),
      Math.max(0, Number(args.cyclesForward || 2))
    );
  }

  const cycles = await prisma.subscriptionBillingCycle.findMany({
    where: { subscriptionId: { in: uniqueSubscriptions.map((sub) => sub.id) } },
    orderBy: [{ subscriptionId: "asc" }, { cycleNumber: "asc" }]
  });

  const cyclesBySubscription = new Map<string, BillingCycleLike[]>();
  for (const cycle of cycles) {
    const list = cyclesBySubscription.get(cycle.subscriptionId) || [];
    list.push(cycle);
    cyclesBySubscription.set(cycle.subscriptionId, list);
  }

  const asOf = args.asOf ? new Date(args.asOf) : new Date();
  return new Map(
    uniqueSubscriptions.map((sub) => [
      sub.id,
      resolveBillingStateFromCycles({
        cycles: cyclesBySubscription.get(sub.id) || [],
        asOf,
        paymentTiming: sub.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
      })
    ])
  );
}

export async function resolveSubscriptionBillingState(args: {
  subscriptionId: string;
  asOf?: Date;
}) {
  const asOf = args.asOf ? new Date(args.asOf) : new Date();
  const subscription = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true }
  });
  if (!subscription) return null;

  await ensureBillingCyclesForSubscriptions([
    buildSubscriptionSeed({
      id: subscription.id,
      startAt: subscription.startAt,
      cycleStartDay: subscription.cycleStartDay,
      paymentDay: subscription.paymentDay,
      paymentTiming: subscription.paymentTiming as any,
      graceDays: subscription.graceDays,
      plan: {
        intervalUnit: subscription.plan.intervalUnit,
        intervalCount: subscription.plan.intervalCount
      }
    })
  ], 0, 2);

  const cycles = await prisma.subscriptionBillingCycle.findMany({
    where: { subscriptionId: subscription.id },
    orderBy: [{ cycleNumber: "asc" }]
  });

  const { activeCycle, collectionCycle, oldestUnpaidCycle } = resolveBillingStateFromCycles({
    cycles,
    asOf,
    paymentTiming: ((subscription.paymentTiming as any) || "EN_CURSO") === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
  });

  return {
    subscription,
    cycles,
    activeCycle,
    collectionCycle,
    oldestUnpaidCycle
  };
}

export async function syncSubscriptionBillingSnapshot(args: {
  subscriptionId: string;
  asOf?: Date;
}) {
  const state = await resolveSubscriptionBillingState(args);
  if (!state?.activeCycle) return null;

  const currentCycle = state.activeCycle.cycleNumber;
  const currentPeriodStartAt = new Date(state.activeCycle.periodStartAt);
  const currentPeriodEndAt = new Date(state.activeCycle.periodEndAt);

  return {
    currentCycle,
    currentPeriodStartAt,
    currentPeriodEndAt,
    activeCycle: state.activeCycle,
    collectionCycle: state.collectionCycle
  };
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
    .filter((cycle) => !isBillingCyclePaid(cycle))
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
  cycleNumberHint?: number | null;
}) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { plan: true }
  });
  if (!subscription) return { ok: false as const, error: "subscription_not_found" as const };

  await ensureBillingCyclesForSubscriptions([
    buildSubscriptionSeed({
      id: subscription.id,
      startAt: subscription.startAt,
      cycleStartDay: subscription.cycleStartDay,
      paymentDay: subscription.paymentDay,
      paymentTiming: subscription.paymentTiming as any,
      graceDays: subscription.graceDays,
      plan: { intervalUnit: subscription.plan.intervalUnit, intervalCount: subscription.plan.intervalCount }
    })
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
    cycleNumberHint: args.cycleNumberHint ?? null,
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
