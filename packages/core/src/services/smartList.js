"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeSmartListRecipients = computeSmartListRecipients;
const prisma_1 = require("../db/prisma");
const client_1 = require("@prisma/client");
const gamification_1 = require("./gamification");
const billingCycles_1 = require("./billingCycles");
function getByPath(obj, path) {
    const parts = path.split(".").filter(Boolean);
    let current = obj;
    for (const part of parts) {
        if (current == null)
            return undefined;
        current = current[part];
    }
    return current;
}
function toComparable(val) {
    if (val == null)
        return null;
    if (val instanceof Date)
        return val.getTime();
    if (typeof val === "string") {
        const t = Date.parse(val);
        if (!Number.isNaN(t))
            return t;
        return val.toLowerCase();
    }
    if (typeof val === "number" || typeof val === "boolean")
        return val;
    return val;
}
function normalizeString(val) {
    if (val == null)
        return "";
    return String(val).toLowerCase();
}
function toDateMs(val) {
    if (val == null)
        return null;
    if (val instanceof Date)
        return val.getTime();
    if (typeof val === "number")
        return Number.isFinite(val) ? val : null;
    if (typeof val === "string") {
        const t = Date.parse(val);
        return Number.isNaN(t) ? null : t;
    }
    return null;
}
function durationMs(amount, unit) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    const u = String(unit || "").toLowerCase();
    if (u.startsWith("sec"))
        return n * 1000;
    if (u.startsWith("min"))
        return n * 60 * 1000;
    if (u.startsWith("hour") || u.startsWith("hr"))
        return n * 60 * 60 * 1000;
    return n * 24 * 60 * 60 * 1000;
}
function toCents(input) {
    const n = Number(input);
    if (!Number.isFinite(n))
        return null;
    return Math.round(n * 100);
}
function normalizeMoneyRuleValue(value) {
    if (value == null)
        return value;
    if (Array.isArray(value)) {
        return value.map((v) => toCents(v)).filter((v) => typeof v === "number");
    }
    if (typeof value === "object") {
        const from = toCents(value?.from ?? value?.min ?? value?.start);
        const to = toCents(value?.to ?? value?.max ?? value?.end);
        return {
            ...(typeof from === "number" ? { from } : {}),
            ...(typeof to === "number" ? { to } : {})
        };
    }
    return toCents(value);
}
function evalRule(rule, ctx) {
    if (!rule)
        return true;
    if ("rules" in rule) {
        const items = Array.isArray(rule.rules) ? rule.rules : [];
        if (rule.op === "or")
            return items.some((r) => evalRule(r, ctx));
        return items.every((r) => evalRule(r, ctx));
    }
    const field = String(rule.field || "").trim();
    const op = rule.op;
    if (!field)
        return true;
    let val;
    if (field.startsWith("metadata."))
        val = getByPath(ctx.metadata, field.replace(/^metadata\./, ""));
    else if (field.startsWith("subscription.metadata."))
        val = getByPath(ctx.subscriptionMeta, field.replace(/^subscription\.metadata\./, ""));
    else
        val = ctx[field];
    if (op === "exists")
        return val != null;
    if (op === "isEmpty")
        return val == null || String(val).trim() === "";
    const isMoneyField = field === "planPrice";
    const ruleValue = isMoneyField ? normalizeMoneyRuleValue(rule.value) : rule.value;
    const cmpVal = toComparable(val);
    const target = toComparable(ruleValue);
    if (op === "equals")
        return cmpVal === target;
    if (op === "contains")
        return normalizeString(cmpVal).includes(normalizeString(target));
    if (op === "startsWith")
        return normalizeString(cmpVal).startsWith(normalizeString(target));
    if (op === "endsWith")
        return normalizeString(cmpVal).endsWith(normalizeString(target));
    if (op === "in")
        return Array.isArray(ruleValue) && ruleValue.map(toComparable).includes(cmpVal);
    if (op === "notIn")
        return Array.isArray(ruleValue) && !ruleValue.map(toComparable).includes(cmpVal);
    if (op === "gt")
        return cmpVal > target;
    if (op === "gte")
        return cmpVal >= target;
    if (op === "lt")
        return cmpVal < target;
    if (op === "lte")
        return cmpVal <= target;
    if (op === "between" && typeof cmpVal === "number") {
        const from = Number(ruleValue?.from ?? (Array.isArray(ruleValue) ? ruleValue[0] : null));
        const to = Number(ruleValue?.to ?? (Array.isArray(ruleValue) ? ruleValue[1] : null));
        if (!Number.isFinite(from) || !Number.isFinite(to))
            return false;
        return cmpVal >= from && cmpVal <= to;
    }
    if (op === "before" || op === "after" || op === "between" || op === "within_last" || op === "within_next" || op === "older_than" || op === "newer_than") {
        const valMs = toDateMs(val);
        if (valMs == null)
            return false;
        const now = Date.now();
        if (op === "before") {
            const t = toDateMs(rule.value);
            return t != null ? valMs < t : false;
        }
        if (op === "after") {
            const t = toDateMs(rule.value);
            return t != null ? valMs > t : false;
        }
        if (op === "between") {
            const from = toDateMs(rule.value?.from ?? (Array.isArray(rule.value) ? rule.value[0] : null));
            const to = toDateMs(rule.value?.to ?? (Array.isArray(rule.value) ? rule.value[1] : null));
            if (from == null || to == null)
                return false;
            return valMs >= from && valMs <= to;
        }
        const amount = Number(rule.value?.amount ?? rule.value?.value ?? 0);
        const unit = String(rule.value?.unit ?? "days");
        const ms = durationMs(amount, unit);
        if (ms <= 0)
            return false;
        if (op === "within_last")
            return valMs >= now - ms && valMs <= now;
        if (op === "within_next")
            return valMs >= now && valMs <= now + ms;
        if (op === "older_than")
            return valMs <= now - ms;
        if (op === "newer_than")
            return valMs >= now - ms;
    }
    return false;
}
async function computeSmartListRecipients(rules) {
    const [customers, approvedCounts, paymentCounts, gamificationScores] = await Promise.all([
        prisma_1.prisma.customer.findMany({
            include: {
                subscriptions: {
                    include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
                    orderBy: { createdAt: "desc" }
                },
                payments: { orderBy: { createdAt: "desc" }, take: 1 },
                tenantLinks: true
            }
        }),
        prisma_1.prisma.payment.groupBy({
            by: ["customerId"],
            where: { status: client_1.PaymentStatus.APPROVED },
            _count: { _all: true }
        }),
        prisma_1.prisma.payment.groupBy({
            by: ["customerId"],
            _count: { _all: true }
        }),
        prisma_1.prisma.gamificationScore.findMany({
            where: { entityType: client_1.GamificationEntityType.CUSTOMER, tenantId: null }
        })
    ]);
    const approvedByCustomer = new Map();
    approvedCounts.forEach((row) => approvedByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));
    const paymentsByCustomer = new Map();
    paymentCounts.forEach((row) => paymentsByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));
    const gamificationByCustomer = new Map();
    gamificationScores.forEach((row) => gamificationByCustomer.set(String(row.entityId), row));
    const now = Date.now();
    const latestSubscriptions = customers
        .map((customer) => customer.subscriptions?.[0] || null)
        .filter((sub) => sub?.plan);
    const billingStateBySubscription = await (0, billingCycles_1.buildSubscriptionBillingStateIndex)({
        subscriptions: latestSubscriptions.map((sub) => ({
            id: sub.id,
            startAt: sub.startAt,
            cycleStartDay: sub.cycleStartDay,
            paymentDay: sub.paymentDay,
            paymentTiming: sub.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO",
            graceDays: sub.graceDays,
            plan: {
                intervalUnit: sub.plan.intervalUnit,
                intervalCount: sub.plan.intervalCount
            }
        })),
        ensureCycles: false
    });
    return customers.filter((customer) => {
        const sub = customer.subscriptions?.[0] || null;
        const latestPayment = customer.payments?.[0] || sub?.payments?.[0] || null;
        const approvedCount = approvedByCustomer.get(String(customer.id)) || 0;
        const totalPayments = paymentsByCustomer.get(String(customer.id)) || 0;
        const gamification = gamificationByCustomer.get(String(customer.id));
        const gamificationLevel = Number(gamification?.level || 1);
        const gamificationLevelName = (0, gamification_1.formatLevelName)(gamificationLevel);
        const billingState = sub ? billingStateBySubscription.get(String(sub.id)) || null : null;
        const activeCycle = billingState?.activeCycle || null;
        const collectionCycle = billingState?.collectionCycle || activeCycle;
        const nextBillingDate = collectionCycle?.dueAt ? new Date(collectionCycle.dueAt) : activeCycle?.periodEndAt ? new Date(activeCycle.periodEndAt) : null;
        // La mora se mide por el ciclo más antiguo SIN pagar (vencido), no por el
        // collectionCycle (en curso, aún no vencido). Igual que subscriptionQueries.ts.
        const delinquencyCycle = billingState?.oldestUnpaidCycle && !(0, billingCycles_1.isBillingCyclePaid)(billingState.oldestUnpaidCycle)
            ? billingState.oldestUnpaidCycle
            : collectionCycle;
        const collectionState = (0, billingCycles_1.resolveCollectionDelinquency)({
            cycle: delinquencyCycle,
            graceDays: sub?.graceDays,
            asOf: new Date(now),
            fallbackSubscriptionStatus: sub?.status ?? null
        });
        const daysPastDue = collectionState.daysPastDue;
        const tier = approvedCount >= 6
            ? "Oro"
            : approvedCount >= 3
                ? "Plata"
                : approvedCount >= 1
                    ? "Bronce"
                    : "Rookie";
        const ctx = {
            email: customer.email || "",
            phone: customer.phone || "",
            name: customer.name || "",
            createdAt: customer.createdAt,
            metadata: customer.metadata || {},
            subscriptionMeta: (sub?.metadata ?? {}),
            subscriptionStatus: sub?.status ?? null,
            planName: sub?.plan?.name ?? null,
            planPrice: sub?.plan?.priceInCents ?? null,
            planActive: sub?.plan?.active ?? null,
            nextBillingDate,
            lastPaymentStatus: latestPayment?.status ?? null,
            lastPaymentDate: latestPayment?.createdAt ?? null,
            paymentsCount: totalPayments,
            approvedPaymentsCount: approvedCount,
            gamificationLevel,
            gamificationLevelName,
            gamificationScore: Number(gamification?.statusScore || 0),
            gamificationLifetime: Number(gamification?.lifetimePoints || 0),
            tier,
            daysPastDue,
            inMora: collectionState.status === "EN_MORA",
            hasSubscription: !!sub,
            paymentStatusLastApproved: latestPayment?.status === client_1.PaymentStatus.APPROVED
        };
        return evalRule(rules, ctx);
    });
}
