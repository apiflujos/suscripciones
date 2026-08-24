"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBillingAnchorFromMetadata = readBillingAnchorFromMetadata;
exports.buildBillingSeed = buildBillingSeed;
exports.buildBillingSeedFromSubscriptionRecord = buildBillingSeedFromSubscriptionRecord;
exports.hasExplicitBillingAnchor = hasExplicitBillingAnchor;
exports.resolveCyclesBackfillWindow = resolveCyclesBackfillWindow;
exports.normalizeBillingSeed = normalizeBillingSeed;
exports.resolveConfiguredCollectionCycle = resolveConfiguredCollectionCycle;
exports.isBillingCyclePaid = isBillingCyclePaid;
exports.resolveCollectionDelinquency = resolveCollectionDelinquency;
exports.computeBillingCycleDueAt = computeBillingCycleDueAt;
exports.buildBillingCyclesForSubscription = buildBillingCyclesForSubscription;
exports.ensureBillingCyclesForSubscriptions = ensureBillingCyclesForSubscriptions;
exports.ensureBillingCyclesForSubscription = ensureBillingCyclesForSubscription;
exports.resolveBillingStateFromCycles = resolveBillingStateFromCycles;
exports.buildSubscriptionBillingStateIndex = buildSubscriptionBillingStateIndex;
exports.resolveSubscriptionBillingState = resolveSubscriptionBillingState;
exports.syncSubscriptionBillingSnapshot = syncSubscriptionBillingSnapshot;
exports.attachPaymentToCycle = attachPaymentToCycle;
exports.findBestBillingCycleForPayment = findBestBillingCycleForPayment;
exports.attachPaymentToMatchingCycle = attachPaymentToMatchingCycle;
exports.reconcileApprovedPaymentWithSubscription = reconcileApprovedPaymentWithSubscription;
const prisma_1 = require("../db/prisma");
const logger_1 = require("../lib/logger");
const client_1 = require("@prisma/client");
const runtimeConfig_1 = require("./runtimeConfig");
const timeZoneScheduling_1 = require("../lib/timeZoneScheduling");
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function parseAnchorDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return new Date(value);
    if (typeof value !== "string" || !value.trim())
        return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function readBillingAnchorFromMetadata(metadata) {
    const root = asRecord(metadata);
    const anchor = asRecord(root.billingAnchor);
    const cycleNumber = Number(anchor.cycleNumber);
    const periodStartAt = parseAnchorDate(anchor.periodStartAt);
    if (!Number.isFinite(cycleNumber) || !periodStartAt)
        return null;
    return {
        cycleNumber: Math.max(1, Math.trunc(cycleNumber)),
        periodStartAt,
        periodEndAt: parseAnchorDate(anchor.periodEndAt),
        dueAt: parseAnchorDate(anchor.dueAt),
        source: String(anchor.source || "").trim() || null
    };
}
function buildBillingSeed(input) {
    return {
        id: input.id,
        startAt: input.startAt ?? null,
        anchorCycleNumber: input.anchorCycleNumber ?? input.currentCycle ?? null,
        anchorPeriodStartAt: input.anchorPeriodStartAt ?? input.currentPeriodStartAt ?? null,
        anchorPeriodEndAt: input.anchorPeriodEndAt ?? input.currentPeriodEndAt ?? null,
        anchorDueAt: input.anchorDueAt ?? null,
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
function buildBillingSeedFromSubscriptionRecord(input) {
    const anchor = readBillingAnchorFromMetadata(input.metadata);
    return buildBillingSeed({
        id: input.id,
        startAt: input.startAt,
        anchorCycleNumber: anchor?.cycleNumber ?? null,
        anchorPeriodStartAt: anchor?.periodStartAt ?? null,
        anchorPeriodEndAt: anchor?.periodEndAt ?? null,
        anchorDueAt: anchor?.dueAt ?? null,
        cycleStartDay: input.cycleStartDay,
        paymentDay: input.paymentDay,
        paymentTiming: input.paymentTiming,
        graceDays: input.graceDays,
        plan: input.plan
    });
}
function hasExplicitBillingAnchor(sub) {
    return (sub.anchorCycleNumber != null ||
        sub.anchorPeriodStartAt instanceof Date ||
        sub.anchorPeriodEndAt instanceof Date ||
        sub.anchorDueAt instanceof Date);
}
function resolveCyclesBackfillWindow(sub, requestedCyclesBack) {
    if (hasExplicitBillingAnchor(sub)) {
        return Math.max(0, Math.trunc(requestedCyclesBack || 0));
    }
    return Math.max(requestedCyclesBack, Math.max(1, Math.trunc(sub.anchorCycleNumber || 1)) - 1);
}
function daysInMonth(year, month0) {
    return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
function shiftIntervalUtc(date, unit, count) {
    const d = new Date(date.getTime());
    const c = Math.trunc(count || 0);
    if (unit === client_1.PlanIntervalUnit.DAY) {
        d.setUTCDate(d.getUTCDate() + c);
        return d;
    }
    if (unit === client_1.PlanIntervalUnit.WEEK) {
        d.setUTCDate(d.getUTCDate() + c * 7);
        return d;
    }
    if (unit === client_1.PlanIntervalUnit.MONTH) {
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
function clampDay(year, month0, day) {
    const last = daysInMonth(year, month0);
    return Math.max(1, Math.min(day, last));
}
function setDayInMonth(base, day) {
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth();
    const d = clampDay(y, m, day);
    return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}
function monthShift(date, delta) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const targetMonth = m + delta;
    const targetYear = y + Math.floor(targetMonth / 12);
    const month0 = ((targetMonth % 12) + 12) % 12;
    return { year: targetYear, month0 };
}
function dateForDayInMonth(year, month0, day) {
    const d = clampDay(year, month0, day);
    return new Date(Date.UTC(year, month0, d, 0, 0, 0, 0));
}
function preserveUtcCivilDate(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0));
}
function resolveCycleStartAnchor(sub) {
    const base = sub.anchorPeriodStartAt ? new Date(sub.anchorPeriodStartAt) : resolveCycleAnchorFromStart(sub);
    const day = Math.max(1, Math.min(31, Math.trunc(sub.cycleStartDay || 1)));
    const candidate = setDayInMonth(base, day);
    if (candidate.getTime() <= base.getTime())
        return candidate;
    const prev = shiftIntervalUtc(candidate, client_1.PlanIntervalUnit.MONTH, -1);
    return prev;
}
function resolveCycleAnchorFromStart(sub) {
    const base = sub.startAt ? new Date(sub.startAt) : sub.anchorPeriodStartAt ? new Date(sub.anchorPeriodStartAt) : new Date();
    if (sub.plan.intervalUnit !== client_1.PlanIntervalUnit.MONTH)
        return base;
    const day = Math.max(1, Math.min(31, Math.trunc(sub.cycleStartDay || 1)));
    const candidate = setDayInMonth(base, day);
    if (candidate.getTime() <= base.getTime())
        return candidate;
    return shiftIntervalUtc(candidate, client_1.PlanIntervalUnit.MONTH, -1);
}
function countElapsedIntervals(args) {
    const startAt = new Date(args.startAt);
    const endAt = new Date(args.endAt);
    const count = Math.max(1, Math.trunc(args.count || 1));
    if (endAt.getTime() <= startAt.getTime())
        return 0;
    if (args.unit === client_1.PlanIntervalUnit.DAY || args.unit === client_1.PlanIntervalUnit.WEEK) {
        const stepDays = args.unit === client_1.PlanIntervalUnit.WEEK ? count * 7 : count;
        const stepMs = stepDays * 24 * 60 * 60 * 1000;
        return Math.max(0, Math.floor((endAt.getTime() - startAt.getTime()) / stepMs));
    }
    let steps = 0;
    const monthsDiff = (endAt.getUTCFullYear() - startAt.getUTCFullYear()) * 12 +
        (endAt.getUTCMonth() - startAt.getUTCMonth());
    if (monthsDiff > 0) {
        steps = Math.floor(monthsDiff / count);
    }
    while (steps > 0) {
        const candidate = shiftIntervalUtc(startAt, args.unit, steps * count);
        if (candidate.getTime() <= endAt.getTime())
            break;
        steps -= 1;
    }
    while (true) {
        const nextCandidate = shiftIntervalUtc(startAt, args.unit, (steps + 1) * count);
        if (nextCandidate.getTime() > endAt.getTime())
            break;
        steps += 1;
    }
    return Math.max(0, steps);
}
function normalizeBillingSeed(sub) {
    const unit = sub.plan.intervalUnit;
    const count = Math.max(1, Math.trunc(sub.plan.intervalCount || 1));
    const hasExplicitAnchor = Number.isFinite(Number(sub.anchorCycleNumber)) &&
        sub.anchorPeriodStartAt instanceof Date &&
        !Number.isNaN(sub.anchorPeriodStartAt.getTime());
    if (hasExplicitAnchor) {
        const rawAnchorCycleNumber = Math.max(1, Math.trunc(Number(sub.anchorCycleNumber || 1)));
        const anchorPeriodStartAt = new Date(sub.anchorPeriodStartAt);
        const inferredCycleNumber = countElapsedIntervals({
            startAt: resolveCycleAnchorFromStart(sub),
            endAt: anchorPeriodStartAt,
            unit,
            count
        }) + 1;
        const anchorCycleNumber = rawAnchorCycleNumber <= 1 && inferredCycleNumber > rawAnchorCycleNumber
            ? inferredCycleNumber
            : rawAnchorCycleNumber;
        const anchorPeriodEndAt = sub.anchorPeriodEndAt instanceof Date && !Number.isNaN(sub.anchorPeriodEndAt.getTime())
            ? new Date(sub.anchorPeriodEndAt)
            : shiftIntervalUtc(anchorPeriodStartAt, unit, count);
        const anchorDueAt = sub.anchorDueAt instanceof Date && !Number.isNaN(sub.anchorDueAt.getTime())
            ? new Date(sub.anchorDueAt)
            : null;
        return {
            ...sub,
            anchorCycleNumber,
            anchorPeriodStartAt,
            anchorPeriodEndAt,
            anchorDueAt
        };
    }
    const anchorStart = resolveCycleAnchorFromStart(sub);
    const referenceAt = sub.anchorPeriodStartAt ? new Date(sub.anchorPeriodStartAt) : new Date();
    const inferredCycle = countElapsedIntervals({
        startAt: anchorStart,
        endAt: referenceAt,
        unit,
        count
    }) + 1;
    const anchorCycleNumber = Math.max(1, Math.max(Math.trunc(sub.anchorCycleNumber || 1), inferredCycle));
    const anchorPeriodStartAt = sub.anchorPeriodStartAt
        ? new Date(sub.anchorPeriodStartAt)
        : shiftIntervalUtc(anchorStart, unit, (anchorCycleNumber - 1) * count);
    const anchorPeriodEndAt = sub.anchorPeriodEndAt
        ? new Date(sub.anchorPeriodEndAt)
        : shiftIntervalUtc(anchorPeriodStartAt, unit, count);
    const anchorDueAt = sub.anchorDueAt instanceof Date && !Number.isNaN(sub.anchorDueAt.getTime()) ? new Date(sub.anchorDueAt) : null;
    return {
        ...sub,
        anchorCycleNumber,
        anchorPeriodStartAt,
        anchorPeriodEndAt,
        anchorDueAt
    };
}
function resolveConfiguredCollectionCycle(args) {
    const asOfTs = new Date(args.asOf).getTime();
    const unpaid = args.cycles
        .filter((cycle) => isBillingCycleCollectible(cycle))
        .sort((a, b) => a.cycleNumber - b.cycleNumber);
    if (!unpaid.length)
        return null;
    const current = unpaid.find((cycle) => {
        const startTs = new Date(cycle.periodStartAt).getTime();
        const endTs = new Date(cycle.periodEndAt).getTime();
        return startTs <= asOfTs && asOfTs < endTs;
    });
    if (args.paymentTiming === "ANTICIPADO") {
        const nextFuture = unpaid.find((cycle) => new Date(cycle.periodStartAt).getTime() > asOfTs);
        return nextFuture || current || unpaid[0];
    }
    // EN_CURSO: mientras exista un ciclo vigente iniciado y aún abierto, ese ciclo
    // gobierna el cobro del período actual aunque existan arrastres históricos.
    // Esto evita que el sistema marque mora antes de tiempo cuando el nuevo período
    // ya fue creado y su dueAt todavía no vence.
    if (current)
        return current;
    const latestOpen = [...unpaid]
        .filter((cycle) => new Date(cycle.periodStartAt).getTime() <= asOfTs)
        .sort((a, b) => new Date(b.periodStartAt).getTime() - new Date(a.periodStartAt).getTime())[0];
    if (latestOpen)
        return latestOpen;
    const overdue = unpaid.filter((cycle) => {
        const dueTs = cycle.dueAt
            ? new Date(cycle.dueAt).getTime()
            : new Date(cycle.periodEndAt).getTime();
        return dueTs < asOfTs;
    });
    if (overdue.length > 0)
        return overdue[0];
    return unpaid[0];
}
function isBillingCyclePaid(cycle) {
    if (!cycle)
        return false;
    return String(cycle.status || "").toUpperCase() === client_1.BillingCycleStatus.PAID;
}
function isBillingCycleSkipped(cycle) {
    if (!cycle)
        return false;
    return String(cycle.status || "").toUpperCase() === client_1.BillingCycleStatus.SKIPPED;
}
function isBillingCycleRelevant(cycle) {
    return Boolean(cycle) && !isBillingCycleSkipped(cycle);
}
function isBillingCycleCollectible(cycle) {
    return isBillingCycleRelevant(cycle) && !isBillingCyclePaid(cycle);
}
function resolveCollectionDelinquency(args) {
    const cycle = args.cycle || null;
    const asOf = args.asOf ? new Date(args.asOf) : new Date();
    const graceDays = Number.isFinite(Number(args.graceDays)) ? Math.max(0, Math.trunc(Number(args.graceDays))) : 0;
    if (isBillingCyclePaid(cycle)) {
        return {
            status: "AL_DIA",
            dueAt: cycle?.dueAt ? new Date(cycle.dueAt) : cycle?.periodEndAt ? new Date(cycle.periodEndAt) : null,
            dueWithGraceAt: null,
            daysPastDue: 0
        };
    }
    const dueAt = cycle?.dueAt ? new Date(cycle.dueAt) : cycle?.periodEndAt ? new Date(cycle.periodEndAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
        const fallback = String(args.fallbackSubscriptionStatus || "").toUpperCase();
        return {
            status: fallback === "PAST_DUE" || fallback === "EXPIRED" ? "EN_MORA" : "AL_DIA",
            dueAt: null,
            dueWithGraceAt: null,
            daysPastDue: 0
        };
    }
    const dueAtTs = dueAt.getTime();
    const asOfTs = asOf.getTime();
    if (asOfTs <= dueAtTs) {
        return {
            status: "AL_DIA",
            dueAt,
            dueWithGraceAt: new Date(dueAtTs + graceDays * 24 * 60 * 60 * 1000),
            daysPastDue: 0
        };
    }
    const daysPastDue = Math.ceil((asOfTs - dueAtTs) / (24 * 60 * 60 * 1000));
    const dueWithGraceAt = new Date(dueAtTs + graceDays * 24 * 60 * 60 * 1000);
    return {
        status: daysPastDue <= graceDays ? "EN_GRACIA" : "EN_MORA",
        dueAt,
        dueWithGraceAt,
        daysPastDue
    };
}
function computeBillingCycleDueAt(params) {
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
function buildBillingCyclesForSubscription(sub, cyclesBack = 12, cyclesForward = 2) {
    const unit = sub.plan.intervalUnit;
    const count = Math.max(1, Math.trunc(sub.plan.intervalCount || 1));
    const anchorCycleNumber = Math.max(1, Math.trunc(sub.anchorCycleNumber || 1));
    const anchorPeriodStartAt = sub.anchorPeriodStartAt ? new Date(sub.anchorPeriodStartAt) : resolveCycleAnchorFromStart(sub);
    const hasExplicitAnchorStart = sub.anchorPeriodStartAt instanceof Date && !Number.isNaN(sub.anchorPeriodStartAt.getTime());
    const anchorStart = unit === client_1.PlanIntervalUnit.MONTH && !hasExplicitAnchorStart
        ? resolveCycleStartAnchor({ ...sub, anchorPeriodStartAt })
        : new Date(anchorPeriodStartAt);
    const cycles = [];
    for (let offset = -cyclesBack; offset <= cyclesForward; offset += 1) {
        const cycleNumber = anchorCycleNumber + offset;
        if (cycleNumber <= 0)
            continue;
        const shift = offset * count;
        const periodStartAt = shiftIntervalUtc(anchorStart, unit, shift);
        const periodEndAt = shiftIntervalUtc(periodStartAt, unit, count);
        const rawDueAt = unit === client_1.PlanIntervalUnit.MONTH
            ? computeBillingCycleDueAt({
                periodStartAt,
                periodEndAt,
                cycleStartDay: sub.cycleStartDay,
                paymentDay: sub.paymentDay,
                paymentTiming: sub.paymentTiming
            })
            : periodEndAt;
        const dueAt = hasExplicitAnchorStart && cycleNumber === anchorCycleNumber && sub.anchorDueAt instanceof Date && !Number.isNaN(sub.anchorDueAt.getTime())
            ? new Date(sub.anchorDueAt)
            : hasExplicitAnchorStart &&
                cycleNumber === anchorCycleNumber &&
                sub.paymentTiming !== "ANTICIPADO" &&
                rawDueAt.getTime() < periodStartAt.getTime()
                ? new Date(periodStartAt)
                : rawDueAt;
        cycles.push({
            subscriptionId: sub.id,
            cycleNumber,
            periodStartAt,
            periodEndAt,
            dueAt,
            status: client_1.BillingCycleStatus.PENDING
        });
    }
    return cycles;
}
async function applyConfiguredExecutionSchedule(cycles) {
    if (!cycles.length)
        return cycles;
    const cfg = await (0, runtimeConfig_1.getAutoDebitConfig)().catch(() => null);
    const executionHour = String(cfg?.executionHour || "09:00").trim() || "09:00";
    const timeZone = String(cfg?.timeZone || "America/Bogota").trim() || "America/Bogota";
    return cycles.map((cycle) => ({
        ...cycle,
        dueAt: (0, timeZoneScheduling_1.applyClockTimeInZone)(preserveUtcCivilDate(new Date(cycle.dueAt)), executionHour, timeZone)
    }));
}
function canRescheduleExistingCycle(cycle, now) {
    if (!cycle)
        return true;
    if (cycle.paymentId)
        return false;
    const status = String(cycle.status || "").trim().toUpperCase();
    if (status === "PAID")
        return false;
    if (status === "FAILED" || status === "SKIPPED")
        return true;
    return new Date(cycle.dueAt).getTime() >= now.getTime();
}
function sameBillingWindow(a, b) {
    if (!a || !b)
        return false;
    return (new Date(a.periodStartAt).getTime() === new Date(b.periodStartAt).getTime() &&
        new Date(a.periodEndAt).getTime() === new Date(b.periodEndAt).getTime());
}
function pickAuthoritativeCycleSeed(args) {
    const hasExplicitAnchor = args.sub.anchorPeriodStartAt instanceof Date ||
        args.sub.anchorPeriodEndAt instanceof Date ||
        Number.isFinite(Number(args.sub.anchorCycleNumber));
    if (hasExplicitAnchor) {
        return normalizeBillingSeed(args.sub);
    }
    const normalized = normalizeBillingSeed(args.sub);
    const relevantExistingCycles = args.existingCycles.filter((cycle) => isBillingCycleRelevant(cycle));
    if (!relevantExistingCycles.length)
        return normalized;
    const projectedCurrentCycle = resolveActiveCycle({
        cycles: buildBillingCyclesForSubscription(normalized, 0, 2),
        asOf: args.asOf
    });
    const matchingProjectedCycle = relevantExistingCycles.find((cycle) => sameBillingWindow(cycle, projectedCurrentCycle)) || null;
    const activeCycle = resolveActiveCycle({ cycles: relevantExistingCycles, asOf: args.asOf });
    const activeCycleStillOpen = activeCycle &&
        new Date(activeCycle.periodStartAt).getTime() <= args.asOf.getTime() &&
        args.asOf.getTime() < new Date(activeCycle.periodEndAt).getTime()
        ? activeCycle
        : null;
    const anchor = matchingProjectedCycle || activeCycleStillOpen;
    if (!anchor)
        return normalized;
    return normalizeBillingSeed({
        ...args.sub,
        anchorCycleNumber: anchor.cycleNumber,
        anchorPeriodStartAt: new Date(anchor.periodStartAt),
        anchorPeriodEndAt: new Date(anchor.periodEndAt),
        anchorDueAt: new Date(anchor.dueAt)
    });
}
async function ensureBillingCyclesForSubscriptions(subs, cyclesBack = 12, cyclesForward = 2) {
    if (!subs.length)
        return;
    const uniqueSubs = Array.from(new Map(subs.map((sub) => [sub.id, sub])).values());
    const existingCycles = await prisma_1.prisma.subscriptionBillingCycle.findMany({
        where: { subscriptionId: { in: uniqueSubs.map((sub) => sub.id) } },
        orderBy: [{ subscriptionId: "asc" }, { cycleNumber: "asc" }]
    });
    const existingCyclesBySubscription = new Map();
    for (const cycle of existingCycles) {
        const list = existingCyclesBySubscription.get(cycle.subscriptionId) || [];
        list.push(cycle);
        existingCyclesBySubscription.set(cycle.subscriptionId, list);
    }
    // La cancelación se consulta acá y no se pide en la semilla a propósito: cada
    // llamador arma la suya y basta con que uno se olvide para que una suscripción
    // cancelada siga generando ciclos. Le pasó a una de prueba, cancelada el 20 de
    // mayo, que acumuló 108 ciclos porque los webhooks la seguían tocando.
    const canceladas = await prisma_1.prisma.subscription.findMany({
        where: { id: { in: uniqueSubs.map((sub) => sub.id) }, canceledAt: { not: null } },
        select: { id: true, canceledAt: true }
    });
    const canceladaEn = new Map(canceladas.map((sub) => [sub.id, new Date(sub.canceledAt).getTime()]));
    const prepared = await Promise.all(uniqueSubs.map(async (rawSub) => {
        const now = new Date();
        const sub = pickAuthoritativeCycleSeed({
            sub: rawSub,
            existingCycles: existingCyclesBySubscription.get(rawSub.id) || [],
            asOf: new Date()
        });
        const safeCyclesBack = resolveCyclesBackfillWindow(rawSub, cyclesBack);
        const cycles = await applyConfiguredExecutionSchedule(buildBillingCyclesForSubscription(sub, safeCyclesBack, cyclesForward));
        const existingByCycle = new Map((existingCyclesBySubscription.get(rawSub.id) || []).map((cycle) => [cycle.cycleNumber, cycle]));
        // Después de cancelar no nacen ciclos nuevos. Los que ya existían se siguen
        // actualizando: un pago tardío tiene que poder aterrizar en su ciclo.
        const cancelTs = canceladaEn.get(rawSub.id);
        const vigentes = cancelTs == null
            ? cycles
            : cycles.filter((c) => existingByCycle.has(c.cycleNumber) || new Date(c.periodStartAt).getTime() < cancelTs);
        return vigentes.map((c) => {
            const existing = existingByCycle.get(c.cycleNumber) || null;
            const keepExisting = existing && !canRescheduleExistingCycle(existing, now);
            const nextPeriodStartAt = keepExisting ? new Date(existing.periodStartAt) : c.periodStartAt;
            const nextPeriodEndAt = keepExisting ? new Date(existing.periodEndAt) : c.periodEndAt;
            const nextDueAt = keepExisting ? new Date(existing.dueAt) : c.dueAt;
            return (prisma_1.prisma.subscriptionBillingCycle.upsert({
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
            }));
        });
    }));
    const ops = prepared.flat();
    for (let i = 0; i < ops.length; i += 50) {
        const chunk = ops.slice(i, i + 50);
        await prisma_1.prisma.$transaction(chunk);
    }
}
async function ensureBillingCyclesForSubscription(args, cyclesForward = 2) {
    const sub = normalizeBillingSeed(args);
    await ensureBillingCyclesForSubscriptions([sub], Math.max(0, Math.max(1, Math.trunc(sub.anchorCycleNumber || 1)) - 1), cyclesForward);
    await syncSubscriptionBillingSnapshot({ subscriptionId: sub.id }).catch(() => null);
}
function resolveActiveCycle(args) {
    const asOfTs = new Date(args.asOf).getTime();
    const relevantCycles = args.cycles.filter((cycle) => isBillingCycleRelevant(cycle));
    const sorted = (relevantCycles.length ? relevantCycles : args.cycles).slice().sort((a, b) => a.cycleNumber - b.cycleNumber);
    const exact = sorted.find((cycle) => {
        const startTs = new Date(cycle.periodStartAt).getTime();
        const endTs = new Date(cycle.periodEndAt).getTime();
        return startTs <= asOfTs && asOfTs < endTs;
    });
    if (exact)
        return exact;
    const latestStarted = [...sorted]
        .filter((cycle) => new Date(cycle.periodStartAt).getTime() <= asOfTs)
        .sort((a, b) => b.cycleNumber - a.cycleNumber)[0];
    if (latestStarted)
        return latestStarted;
    return sorted[0] || null;
}
function resolveBillingStateFromCycles(args) {
    const activeCycle = resolveActiveCycle({ cycles: args.cycles, asOf: args.asOf });
    const collectionCycle = resolveConfiguredCollectionCycle({
        cycles: args.cycles,
        asOf: args.asOf,
        paymentTiming: args.paymentTiming
    });
    const oldestUnpaidCycle = args.cycles.find((cycle) => isBillingCycleCollectible(cycle)) || null;
    return {
        activeCycle,
        collectionCycle,
        oldestUnpaidCycle
    };
}
async function buildSubscriptionBillingStateIndex(args) {
    const subscriptions = args.subscriptions.map((sub) => normalizeBillingSeed(sub));
    if (!subscriptions.length)
        return new Map();
    const uniqueSubscriptions = Array.from(new Map(subscriptions.map((sub) => [sub.id, sub])).values());
    if (args.ensureCycles !== false) {
        await ensureBillingCyclesForSubscriptions(uniqueSubscriptions, Math.max(...uniqueSubscriptions.map((sub) => Math.max(0, Number(sub.anchorCycleNumber || 1) - 1)), 0), Math.max(0, Number(args.cyclesForward || 2)));
    }
    const cycles = await prisma_1.prisma.subscriptionBillingCycle.findMany({
        where: { subscriptionId: { in: uniqueSubscriptions.map((sub) => sub.id) } },
        orderBy: [{ subscriptionId: "asc" }, { cycleNumber: "asc" }]
    });
    const cyclesBySubscription = new Map();
    for (const cycle of cycles) {
        const list = cyclesBySubscription.get(cycle.subscriptionId) || [];
        list.push(cycle);
        cyclesBySubscription.set(cycle.subscriptionId, list);
    }
    const asOf = args.asOf ? new Date(args.asOf) : new Date();
    return new Map(uniqueSubscriptions.map((sub) => [
        sub.id,
        resolveBillingStateFromCycles({
            cycles: cyclesBySubscription.get(sub.id) || [],
            asOf,
            paymentTiming: sub.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
        })
    ]));
}
async function resolveSubscriptionBillingState(args) {
    const asOf = args.asOf ? new Date(args.asOf) : new Date();
    const subscription = await prisma_1.prisma.subscription.findUnique({
        where: { id: args.subscriptionId },
        include: { plan: true }
    });
    if (!subscription)
        return null;
    await ensureBillingCyclesForSubscriptions([
        buildBillingSeedFromSubscriptionRecord({
            id: subscription.id,
            startAt: subscription.startAt,
            cycleStartDay: subscription.cycleStartDay,
            paymentDay: subscription.paymentDay,
            paymentTiming: subscription.paymentTiming,
            graceDays: subscription.graceDays,
            metadata: subscription.metadata,
            plan: {
                intervalUnit: subscription.plan.intervalUnit,
                intervalCount: subscription.plan.intervalCount
            }
        })
    ], 0, 2);
    const cycles = await prisma_1.prisma.subscriptionBillingCycle.findMany({
        where: { subscriptionId: subscription.id },
        orderBy: [{ cycleNumber: "asc" }]
    });
    const { activeCycle, collectionCycle, oldestUnpaidCycle } = resolveBillingStateFromCycles({
        cycles,
        asOf,
        paymentTiming: (subscription.paymentTiming || "EN_CURSO") === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
    });
    return {
        subscription,
        cycles,
        activeCycle,
        collectionCycle,
        oldestUnpaidCycle
    };
}
async function syncSubscriptionBillingSnapshot(args) {
    const state = await resolveSubscriptionBillingState(args);
    if (!state?.activeCycle)
        return null;
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
async function attachPaymentToCycle(args) {
    const paymentAt = args.paymentAt;
    const cycle = await prisma_1.prisma.subscriptionBillingCycle.findUnique({
        where: { id: args.cycleId },
        include: { subscription: { select: { graceDays: true } } }
    });
    if (!cycle)
        return { ok: false, error: "cycle_not_found" };
    if (cycle.subscriptionId !== args.subscriptionId)
        return { ok: false, error: "cycle_mismatch" };
    const dueAt = cycle.dueAt || cycle.periodEndAt;
    const autoDebitConfig = await (0, runtimeConfig_1.getAutoDebitConfig)().catch(() => null);
    const graceDays = Number.isFinite(Number(autoDebitConfig?.graceDays))
        ? Math.max(0, Math.trunc(Number(autoDebitConfig?.graceDays || 0)))
        : Number.isFinite(cycle.subscription?.graceDays)
            ? Math.max(0, Number(cycle.subscription?.graceDays || 0))
            : 0;
    const dueWithGrace = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
    const msDiff = paymentAt.getTime() - dueWithGrace.getTime();
    const daysLate = msDiff > 0 ? Math.ceil(msDiff / (24 * 60 * 60 * 1000)) : 0;
    const daysEarly = msDiff < 0 ? Math.ceil(Math.abs(msDiff) / (24 * 60 * 60 * 1000)) : 0;
    const paidOnTime = msDiff <= 0;
    await prisma_1.prisma.subscriptionBillingCycle.update({
        where: { id: args.cycleId },
        data: {
            paymentId: args.paymentId,
            paidAt: paymentAt,
            status: client_1.BillingCycleStatus.PAID,
            paidOnTime,
            daysEarly,
            daysLate,
            origin: args.origin || undefined,
            associationReason: args.associationReason || undefined,
            associatedBy: args.associatedBy || undefined
        }
    });
    return { ok: true };
}
function findBestBillingCycleForPayment(args) {
    const toleranceDays = Number.isFinite(args.toleranceDays) ? Math.max(0, Math.trunc(args.toleranceDays)) : 7;
    const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
    const paymentTs = args.paymentAt.getTime();
    const unpaidCycles = args.cycles
        .filter((cycle) => isBillingCycleCollectible(cycle))
        .map((cycle) => ({
        ...cycle,
        periodStartMs: new Date(cycle.periodStartAt).getTime(),
        periodEndMs: new Date(cycle.periodEndAt).getTime(),
        dueAtMs: new Date(cycle.dueAt || cycle.periodEndAt).getTime()
    }));
    if (!unpaidCycles.length)
        return null;
    const strictPeriodMatch = unpaidCycles.filter((cycle) => {
        return paymentTs >= cycle.periodStartMs && paymentTs < cycle.periodEndMs;
    });
    if (strictPeriodMatch.length) {
        strictPeriodMatch.sort((a, b) => a.periodStartMs - b.periodStartMs || a.cycleNumber - b.cycleNumber);
        return strictPeriodMatch[0];
    }
    const withinWindow = unpaidCycles.filter((cycle) => {
        const start = cycle.periodStartMs - toleranceMs;
        const end = cycle.periodEndMs + toleranceMs;
        return paymentTs >= start && paymentTs <= end;
    });
    if (withinWindow.length) {
        withinWindow.sort((a, b) => a.periodStartMs - b.periodStartMs || a.cycleNumber - b.cycleNumber);
        return withinWindow[0];
    }
    if (args.cycleNumberHint != null) {
        const direct = unpaidCycles.find((cycle) => cycle.cycleNumber === args.cycleNumberHint);
        if (direct) {
            const start = direct.periodStartMs - toleranceMs;
            const end = direct.periodEndMs + toleranceMs;
            if (paymentTs >= start && paymentTs <= end)
                return direct;
        }
    }
    const overdue = unpaidCycles.filter((cycle) => cycle.dueAtMs <= paymentTs);
    if (overdue.length) {
        overdue.sort((a, b) => a.dueAtMs - b.dueAtMs || a.cycleNumber - b.cycleNumber);
        return overdue[0];
    }
    const nearestFuture = unpaidCycles
        .filter((cycle) => cycle.dueAtMs > paymentTs)
        .sort((a, b) => a.dueAtMs - b.dueAtMs || a.cycleNumber - b.cycleNumber);
    if (nearestFuture.length)
        return nearestFuture[0];
    unpaidCycles.sort((a, b) => a.dueAtMs - b.dueAtMs || a.cycleNumber - b.cycleNumber);
    return unpaidCycles[0];
}
async function attachPaymentToMatchingCycle(args) {
    const subscription = await prisma_1.prisma.subscription.findUnique({
        where: { id: args.subscriptionId },
        include: { plan: true }
    });
    if (!subscription)
        return { ok: false, error: "subscription_not_found" };
    await ensureBillingCyclesForSubscriptions([
        buildBillingSeedFromSubscriptionRecord({
            id: subscription.id,
            startAt: subscription.startAt,
            cycleStartDay: subscription.cycleStartDay,
            paymentDay: subscription.paymentDay,
            paymentTiming: subscription.paymentTiming,
            graceDays: subscription.graceDays,
            metadata: subscription.metadata,
            plan: { intervalUnit: subscription.plan.intervalUnit, intervalCount: subscription.plan.intervalCount }
        })
    ]).catch((err) => {
        logger_1.logger.warn({ err, subscriptionId: subscription.id }, "billingCycles: fallo asegurando ciclos antes de match");
    });
    const toleranceDays = Number.isFinite(args.toleranceDays) ? Math.max(0, Math.trunc(args.toleranceDays)) : 7;
    const cycles = await prisma_1.prisma.subscriptionBillingCycle.findMany({
        where: {
            subscriptionId: subscription.id,
            paymentId: null,
            status: { not: client_1.BillingCycleStatus.PAID }
        },
        orderBy: [{ dueAt: "asc" }, { cycleNumber: "asc" }]
    });
    const match = findBestBillingCycleForPayment({
        cycles,
        paymentAt: args.paymentAt,
        cycleNumberHint: args.cycleNumberHint ?? null,
        toleranceDays
    });
    if (!match)
        return { ok: false, error: "cycle_not_found" };
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
async function reconcileApprovedPaymentWithSubscription(args) {
    const asOf = args.asOf ? new Date(args.asOf) : new Date(args.paymentAt);
    let linkedCycle = await prisma_1.prisma.subscriptionBillingCycle.findFirst({
        where: { paymentId: args.paymentId },
        select: { id: true, cycleNumber: true }
    });
    if (!linkedCycle) {
        const attachResult = args.cycleId
            ? await attachPaymentToCycle({
                paymentId: args.paymentId,
                subscriptionId: args.subscriptionId,
                cycleId: args.cycleId,
                paymentAt: args.paymentAt,
                origin: args.origin,
                associationReason: args.associationReason,
                associatedBy: args.associatedBy
            })
            : await attachPaymentToMatchingCycle({
                subscriptionId: args.subscriptionId,
                paymentId: args.paymentId,
                paymentAt: args.paymentAt,
                origin: args.origin,
                associationReason: args.associationReason,
                associatedBy: args.associatedBy,
                cycleNumberHint: args.cycleNumberHint ?? null
            });
        if (!attachResult.ok) {
            logger_1.logger.warn({
                subscriptionId: args.subscriptionId,
                paymentId: args.paymentId,
                cycleId: args.cycleId ?? null,
                cycleNumberHint: args.cycleNumberHint ?? null,
                error: attachResult.error
            }, "billingCycles: no se pudo adjuntar pago aprobado a un ciclo");
        }
        linkedCycle = await prisma_1.prisma.subscriptionBillingCycle.findFirst({
            where: { paymentId: args.paymentId },
            select: { id: true, cycleNumber: true }
        });
    }
    if (linkedCycle) {
        const desiredKey = `${args.subscriptionId}:${linkedCycle.cycleNumber}`;
        await prisma_1.prisma.payment.update({
            where: { id: args.paymentId },
            data: {
                subscriptionId: args.subscriptionId,
                cycleNumber: linkedCycle.cycleNumber,
                subscriptionCycleKey: desiredKey,
                ...(args.associationReason ? { associationReason: args.associationReason } : {}),
                ...(args.associatedBy ? { associatedBy: args.associatedBy } : {})
            }
        }).catch((err) => {
            logger_1.logger.warn({ err, subscriptionId: args.subscriptionId, paymentId: args.paymentId, cycleNumber: linkedCycle?.cycleNumber }, "billingCycles: fallo sincronizando llaves de ciclo del pago aprobado");
        });
    }
    const state = await resolveSubscriptionBillingState({ subscriptionId: args.subscriptionId, asOf }).catch((err) => {
        logger_1.logger.warn({ err, subscriptionId: args.subscriptionId, paymentId: args.paymentId }, "billingCycles: fallo resolviendo estado tras pago aprobado");
        return null;
    });
    const collectionCycle = state?.collectionCycle || state?.activeCycle || null;
    const delinquency = resolveCollectionDelinquency({
        cycle: collectionCycle,
        graceDays: state?.subscription?.graceDays ?? 5,
        asOf,
        fallbackSubscriptionStatus: state?.subscription?.status ?? null
    });
    const nextStatus = delinquency.status === "EN_MORA" ? client_1.SubscriptionStatus.PAST_DUE : client_1.SubscriptionStatus.ACTIVE;
    await prisma_1.prisma.subscription.update({
        where: { id: args.subscriptionId },
        data: {
            status: nextStatus,
            ...(nextStatus === client_1.SubscriptionStatus.ACTIVE
                ? { retryCount: 0, suspendedAt: null, canceledAt: null }
                : {})
        }
    }).catch((err) => {
        logger_1.logger.warn({ err, subscriptionId: args.subscriptionId, paymentId: args.paymentId, nextStatus }, "billingCycles: fallo reconciliando estado de suscripcion tras pago aprobado");
    });
    return {
        linkedCycle,
        state,
        delinquency,
        nextStatus
    };
}
