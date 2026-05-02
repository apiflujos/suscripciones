import "server-only";

import { prisma } from "@suscripciones/database";
import { PaymentStatus, PlanIntervalUnit, Prisma } from "@prisma/client";
import { addIntervalUtc, toUtc } from "@suscripciones/core/lib/dates";
import { computeBillingCycleDueAt, resolveSubscriptionBillingState } from "@suscripciones/core/services/billingCycles";
import { readSubscriptionTotalInCents } from "@suscripciones/core/services/subscriptionBilling";
import { validateWompiCurrency } from "@suscripciones/core/lib/wompiSignature";

export const DEFAULT_SUBSCRIPTION_CYCLE_START_DAY = 1;
export const DEFAULT_SUBSCRIPTION_PAYMENT_DAY = 1;
export const DEFAULT_SUBSCRIPTION_PAYMENT_TIMING: "EN_CURSO" | "ANTICIPADO" = "EN_CURSO";

export const subscriptionIdJsonFilter = (subscriptionId: string) =>
  ({ path: ["subscriptionId"], equals: subscriptionId } as unknown as Prisma.JsonFilter);

export const stringContainsJsonFilter = (path: string[], value: string) =>
  ({ path, string_contains: value } as unknown as Prisma.JsonFilter);

export const collectionModePlanWhere = (collectionMode: string) =>
  ({ metadata: { path: ["collectionMode"], equals: collectionMode } as unknown as Prisma.JsonFilter }) satisfies Prisma.SubscriptionPlanWhereInput;

function daysInMonthUtc(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function subtractIntervalUtc(date: Date, unit: string, count: number): Date {
  const normalizedDate = toUtc(date);
  const c = Math.max(0, Math.trunc(count || 0));
  const d = new Date(normalizedDate.getTime());

  if (unit === "DAY") {
    d.setUTCDate(d.getUTCDate() - c);
    return d;
  }
  if (unit === "WEEK") {
    d.setUTCDate(d.getUTCDate() - c * 7);
    return d;
  }
  if (unit === "MONTH") {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const targetMonth = m - c;
    const targetYear = y + Math.floor(targetMonth / 12);
    const month0 = ((targetMonth % 12) + 12) % 12;
    const last = daysInMonthUtc(targetYear, month0);
    d.setUTCFullYear(targetYear);
    d.setUTCDate(1);
    d.setUTCMonth(month0);
    d.setUTCDate(Math.min(day, last));
    return d;
  }

  d.setUTCDate(d.getUTCDate() - c);
  return d;
}

function clampDayUtc(year: number, month0: number, day: number) {
  const last = daysInMonthUtc(year, month0);
  return Math.max(1, Math.min(day, last));
}

function dateForDayInMonthUtc(year: number, month0: number, day: number) {
  const d = clampDayUtc(year, month0, day);
  return new Date(Date.UTC(year, month0, d, 0, 0, 0, 0));
}

function shiftMonths(year: number, month0: number, delta: number) {
  const targetMonth = month0 + delta;
  const targetYear = year + Math.floor(targetMonth / 12);
  const nextMonth0 = ((targetMonth % 12) + 12) % 12;
  return { year: targetYear, month0: nextMonth0 };
}

export function resolveMonthlyPeriodStart(now: Date, cycleStartDay: number) {
  const year = now.getUTCFullYear();
  const month0 = now.getUTCMonth();
  const candidate = dateForDayInMonthUtc(year, month0, cycleStartDay);
  if (now.getTime() >= candidate.getTime()) return candidate;
  const prev = shiftMonths(year, month0, -1);
  return dateForDayInMonthUtc(prev.year, prev.month0, cycleStartDay);
}

export function normalizeInterval(unit: string, count: number) {
  const safeCount = Math.max(1, Math.trunc(count || 1));
  if (unit === "YEAR") {
    return { unit: "MONTH", count: safeCount * 12 };
  }
  return { unit, count: safeCount };
}

export function resolvePeriodStartFromAnchor(now: Date, anchor: Date, unit: string, count: number) {
  const normalizedNow = toUtc(now);
  const normalizedAnchor = toUtc(anchor);
  const safeCount = Math.max(1, Math.trunc(count || 1));

  if (unit === "DAY" || unit === "WEEK") {
    const dayMs = 24 * 60 * 60 * 1000;
    const intervalMs = dayMs * safeCount * (unit === "WEEK" ? 7 : 1);
    const diff = normalizedNow.getTime() - normalizedAnchor.getTime();
    const steps = diff >= 0 ? Math.floor(diff / intervalMs) : 0;
    return new Date(normalizedAnchor.getTime() + steps * intervalMs);
  }

  if (unit === "MONTH") {
    const anchorYear = normalizedAnchor.getUTCFullYear();
    const anchorMonth = normalizedAnchor.getUTCMonth();
    const nowYear = normalizedNow.getUTCFullYear();
    const nowMonth = normalizedNow.getUTCMonth();
    const monthsDiff = (nowYear - anchorYear) * 12 + (nowMonth - anchorMonth);
    const steps = monthsDiff >= 0 ? Math.floor(monthsDiff / safeCount) : 0;
    return addIntervalUtc(normalizedAnchor, PlanIntervalUnit.MONTH, steps * safeCount);
  }

  return normalizedAnchor;
}

export function computeDueAtForPeriod(args: {
  periodStartAt?: Date | null;
  periodEndAt?: Date | null;
  cycleStartDay?: number;
  paymentDay?: number;
  paymentTiming?: string;
  intervalUnit?: string;
}) {
  const { periodStartAt, periodEndAt } = args;
  if (!periodStartAt || !periodEndAt) return periodEndAt || null;
  const intervalUnit = String(args.intervalUnit || "MONTH").toUpperCase();
  if (intervalUnit !== "MONTH") return periodEndAt;
  return computeBillingCycleDueAt({
    periodStartAt: toUtc(periodStartAt),
    periodEndAt: toUtc(periodEndAt),
    cycleStartDay: Math.max(1, Math.min(31, Math.trunc(args.cycleStartDay || 1))),
    paymentDay: Math.max(1, Math.min(31, Math.trunc(args.paymentDay || 1))),
    paymentTiming: String(args.paymentTiming || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
  });
}

export function computePlanTotalInCents(args: {
  basePriceInCents: number;
  variantDeltaInCents: number;
  shippingInCents: number;
  discountType?: string | null;
  discountValueInCents?: number | null;
  discountPercent?: number | null;
  taxPercent?: number | null;
}) {
  const base = Number(args.basePriceInCents || 0);
  const delta = Number(args.variantDeltaInCents || 0);
  const shipping = Number(args.shippingInCents || 0);
  const discountType = String(args.discountType || "NONE");
  const discountValue = Number(args.discountValueInCents || 0);
  const discountPercent = Number(args.discountPercent || 0);
  const taxPercent = Number(args.taxPercent || 0);
  let subtotal = base + delta + shipping;
  if (discountType === "FIXED") subtotal -= discountValue;
  else if (discountType === "PERCENT") subtotal -= Math.round((subtotal * discountPercent) / 100);
  if (subtotal < 0) subtotal = 0;
  const taxInCents = Math.round((subtotal * taxPercent) / 100);
  return { subtotalInCents: subtotal, taxInCents, totalInCents: subtotal + taxInCents };
}

export function readPlanPricing(meta: unknown) {
  if (!meta || typeof meta !== "object") return {};
  const source = meta as Record<string, unknown>;
  const root = source.pricing;
  const catalog = source.catalog;
  const legacy = catalog && typeof catalog === "object" ? (catalog as Record<string, unknown>).pricing : undefined;
  if (root && typeof root === "object") return root;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

export async function recordManualChargeFailure(args: {
  subscription: {
    id?: string | null;
    customerId?: string | null;
    tenantId?: string | null;
    metadata?: unknown;
    plan?: { tenantId?: string | null; priceInCents?: number | null; currency?: string | null } | null;
  };
  amountInCentsOverride?: number;
  errorCode: string;
  details?: unknown;
}) {
  const subscription = args.subscription;
  const tenantId = subscription?.tenantId || subscription?.plan?.tenantId;
  if (!subscription?.id || !subscription?.customerId || !tenantId) return null;

  const billingState = await resolveSubscriptionBillingState({ subscriptionId: subscription.id }).catch(() => null);
  const cycle = Number(billingState?.collectionCycle?.cycleNumber || billingState?.activeCycle?.cycleNumber || 1);
  const reference = `SUB_${subscription.id}_${cycle}`;
  const subscriptionCycleKey = `${subscription.id}:${cycle}`;
  const amountInCents = Math.trunc(args.amountInCentsOverride ?? readSubscriptionTotalInCents(subscription.metadata, subscription.plan?.priceInCents ?? 0));
  const currency = validateWompiCurrency(String(subscription.plan?.currency || "COP"));
  const existing = await prisma.payment.findUnique({
    where: { subscriptionCycleKey },
    select: { id: true, status: true }
  });

  if (existing?.status === PaymentStatus.APPROVED) return existing.id;

  const payment = await prisma.payment.upsert({
    where: { subscriptionCycleKey },
    create: {
      tenantId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      amountInCents,
      currency,
      cycleNumber: cycle,
      reference,
      status: PaymentStatus.ERROR,
      failedAt: new Date(),
      subscriptionCycleKey
    },
    update: {
      tenantId,
      amountInCents,
      currency,
      reference,
      status: PaymentStatus.ERROR,
      failedAt: new Date()
    }
  });

  const lastAttempt = await prisma.paymentAttempt.findFirst({
    where: { paymentId: payment.id },
    orderBy: [{ attemptNo: "desc" }, { createdAt: "desc" }],
    select: { attemptNo: true }
  });

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: Number(lastAttempt?.attemptNo || 0) + 1,
      status: "MANUAL_CHARGE_FAILED",
      errorCode: args.errorCode,
      errorMessage: args.errorCode,
      provider: "apiflujos",
      response: args.details ? (args.details as Prisma.InputJsonValue) : undefined
    }
  });

  return payment.id;
}
