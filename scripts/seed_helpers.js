const { BillingCycleStatus, PaymentStatus } = require("@prisma/client");

function clampDay(year, month0, day) {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return Math.max(1, Math.min(Number(day || 1), last));
}

function dateForDayInMonthUtc(year, month0, day) {
  return new Date(Date.UTC(year, month0, clampDay(year, month0, day), 0, 0, 0, 0));
}

function monthShift(date, delta) {
  const year = date.getUTCFullYear();
  const month0 = date.getUTCMonth();
  const nextMonth = month0 + delta;
  return {
    year: year + Math.floor(nextMonth / 12),
    month0: ((nextMonth % 12) + 12) % 12
  };
}

function addIntervalUtc(date, unit, count) {
  const base = new Date(date.getTime());
  const normalizedCount = Math.trunc(Number(count || 0));
  const safeCount = normalizedCount === 0 ? 1 : normalizedCount;
  const normalizedUnit = String(unit || "MONTH").toUpperCase();
  if (normalizedUnit === "DAY" || normalizedUnit === "CUSTOM") {
    base.setUTCDate(base.getUTCDate() + safeCount);
    return base;
  }
  if (normalizedUnit === "WEEK") {
    base.setUTCDate(base.getUTCDate() + safeCount * 7);
    return base;
  }
  const year = base.getUTCFullYear();
  const month0 = base.getUTCMonth();
  const day = base.getUTCDate();
  const nextMonth = month0 + safeCount;
  const nextYear = year + Math.floor(nextMonth / 12);
  const normalizedMonth0 = ((nextMonth % 12) + 12) % 12;
  const nextDay = clampDay(nextYear, normalizedMonth0, day);
  return new Date(Date.UTC(nextYear, normalizedMonth0, nextDay, 0, 0, 0, 0));
}

function computeBillingCycleDueAt(params) {
  const periodStartAt = new Date(params.periodStartAt);
  const cycleStartDay = Math.max(1, Math.min(31, Math.trunc(params.cycleStartDay || 1)));
  const paymentDay = Math.max(1, Math.min(31, Math.trunc(params.paymentDay || 1)));
  const paymentTiming = String(params.paymentTiming || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";

  if (paymentTiming === "ANTICIPADO") {
    const prev = monthShift(periodStartAt, -1);
    return dateForDayInMonthUtc(prev.year, prev.month0, paymentDay);
  }

  const startYear = periodStartAt.getUTCFullYear();
  const startMonth0 = periodStartAt.getUTCMonth();
  if (paymentDay >= cycleStartDay) {
    return dateForDayInMonthUtc(startYear, startMonth0, paymentDay);
  }
  const next = monthShift(periodStartAt, 1);
  return dateForDayInMonthUtc(next.year, next.month0, paymentDay);
}

function buildBillingCycles(args) {
  const subscriptionId = String(args.subscriptionId);
  const rawAnchorCycleNumber = args.anchorCycleNumber ?? args.currentCycle ?? 1;
  const anchorCycleNumber = Math.max(1, Math.trunc(rawAnchorCycleNumber));
  const intervalUnit = String(args.intervalUnit || "MONTH").toUpperCase();
  const intervalCount = Math.max(1, Math.trunc(args.intervalCount || 1));
  const cycleStartDay = Math.max(1, Math.min(31, Math.trunc(args.cycleStartDay || 1)));
  const paymentDay = Math.max(1, Math.min(31, Math.trunc(args.paymentDay || cycleStartDay)));
  const paymentTiming = String(args.paymentTiming || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
  const anchorPeriodStartAt = new Date(args.anchorPeriodStartAt || args.currentPeriodStartAt);
  const cyclesBack = Math.max(0, Math.trunc(args.cyclesBack || 0));
  const cyclesForward = Math.max(0, Math.trunc(args.cyclesForward || 0));
  const cycles = [];

  for (let offset = -cyclesBack; offset <= cyclesForward; offset += 1) {
    const cycleNumber = anchorCycleNumber + offset;
    if (cycleNumber <= 0) continue;
    const shift = offset * intervalCount;
    const periodStartAt = addIntervalUtc(anchorPeriodStartAt, intervalUnit, shift);
    const periodEndAt = addIntervalUtc(periodStartAt, intervalUnit, intervalCount);
    const dueAt =
      intervalUnit === "MONTH"
        ? computeBillingCycleDueAt({ periodStartAt, cycleStartDay, paymentDay, paymentTiming })
        : periodEndAt;
    cycles.push({
      subscriptionId,
      cycleNumber,
      periodStartAt,
      periodEndAt,
      dueAt,
      status: BillingCycleStatus.PENDING
    });
  }

  return cycles.sort((a, b) => a.cycleNumber - b.cycleNumber);
}

function cycleStatusFromPaymentStatus(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === PaymentStatus.APPROVED) return BillingCycleStatus.PAID;
  if (normalized === PaymentStatus.DECLINED || normalized === PaymentStatus.ERROR) return BillingCycleStatus.FAILED;
  return BillingCycleStatus.PENDING;
}

function paymentLinkStatusFromPaymentStatus(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === PaymentStatus.APPROVED) return "PAID";
  if (normalized === PaymentStatus.DECLINED || normalized === PaymentStatus.ERROR) return "FAILED";
  return "SENT";
}

function readCollectionMode(plan) {
  const raw = String(plan?.metadata?.collectionMode || "").toUpperCase();
  if (raw === "AUTO_DEBIT" || raw === "AUTO_LINK" || raw === "MANUAL_LINK") return raw;
  return String(plan?.planType || "").toLowerCase() === "auto_subscription" ? "AUTO_DEBIT" : "MANUAL_LINK";
}

function resolveCollectionMode(plan) {
  return readCollectionMode(plan);
}

function buildPricing(plan, shippingInCents, currency) {
  const pricing = plan?.metadata?.pricing && typeof plan.metadata.pricing === "object" ? plan.metadata.pricing : {};
  const basePriceInCents = Math.trunc(Number(pricing.basePriceInCents ?? plan.priceInCents ?? 0));
  const shipping = Math.trunc(Number(pricing.shippingInCents ?? shippingInCents ?? 0));
  return {
    ...pricing,
    basePriceInCents,
    shippingInCents: shipping,
    totalInCents: basePriceInCents + shipping,
    currency: currency || plan.currency || "COP"
  };
}

async function ensureTenantLinks(prisma, args) {
  const tenantId = String(args.tenantId || "").trim();
  if (!tenantId) return;
  if (args.customerId) {
    await prisma.customerTenant.createMany({
      data: [{ customerId: args.customerId, tenantId }],
      skipDuplicates: true
    });
  }
  if (args.planId) {
    await prisma.subscriptionPlanTenant.createMany({
      data: [{ planId: args.planId, tenantId }],
      skipDuplicates: true
    });
  }
  if (args.subscriptionId) {
    await prisma.subscriptionTenant.createMany({
      data: [{ subscriptionId: args.subscriptionId, tenantId }],
      skipDuplicates: true
    });
  }
}

async function createSubscriptionWithCycles(prisma, args) {
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: args.tenantId,
      customerId: args.customerId,
      empresaId: args.empresaId || null,
      contactoId: args.contactoId || null,
      planId: args.planId,
      status: args.status,
      startAt: args.startAt,
      cycleStartDay: args.cycleStartDay,
      paymentDay: args.paymentDay,
      paymentTiming: args.paymentTiming,
      graceDays: args.graceDays,
      retryCount: args.retryCount || 0,
      maxRetries: args.maxRetries || 3,
      canceledAt: args.canceledAt || null,
      suspendedAt: args.suspendedAt || null,
      metadata: args.metadata || null
    }
  });

  const cycles = buildBillingCycles({
    subscriptionId: subscription.id,
    anchorCycleNumber: args.anchorCycleNumber ?? args.currentCycle,
    anchorPeriodStartAt: args.anchorPeriodStartAt || args.currentPeriodStartAt,
    cycleStartDay: args.cycleStartDay,
    paymentDay: args.paymentDay,
    paymentTiming: args.paymentTiming,
    intervalUnit: args.intervalUnit,
    intervalCount: args.intervalCount,
    cyclesBack: args.cyclesBack,
    cyclesForward: args.cyclesForward
  });

  if (cycles.length) {
    await prisma.subscriptionBillingCycle.createMany({
      data: cycles.map((cycle) => ({
        subscriptionId: cycle.subscriptionId,
        cycleNumber: cycle.cycleNumber,
        periodStartAt: cycle.periodStartAt,
        periodEndAt: cycle.periodEndAt,
        dueAt: cycle.dueAt,
        status: cycle.status
      })),
      skipDuplicates: true
    });
  }

  await ensureTenantLinks(prisma, {
    tenantId: args.tenantId,
    subscriptionId: subscription.id
  });

  return { subscription, cycles };
}

module.exports = {
  BillingCycleStatus,
  buildBillingCycles,
  buildPricing,
  computeBillingCycleDueAt,
  createSubscriptionWithCycles,
  cycleStatusFromPaymentStatus,
  dateForDayInMonthUtc,
  ensureTenantLinks,
  paymentLinkStatusFromPaymentStatus,
  readCollectionMode,
  resolveCollectionMode
};
