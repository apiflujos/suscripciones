import { prisma } from "../db/prisma";
import { SubscriptionStatus, PaymentStatus, GamificationEntityType } from "@prisma/client";
import { formatLevelName } from "./gamification";
import { buildSubscriptionBillingStateIndex, resolveCollectionDelinquency, isBillingCyclePaid } from "./billingCycles";

export type SmartListRule =
  | {
      field: string;
      op:
        | "equals"
        | "contains"
        | "startsWith"
        | "endsWith"
        | "in"
        | "notIn"
        | "gt"
        | "gte"
        | "lt"
        | "lte"
        | "before"
        | "after"
        | "between"
        | "within_last"
        | "within_next"
        | "older_than"
        | "newer_than"
        | "exists"
        | "isEmpty";
      value?: any;
    }
  | { op: "and" | "or"; rules: SmartListRule[] };

function getByPath(obj: any, path: string) {
  const parts = path.split(".").filter(Boolean);
  let current = obj as any;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function toComparable(val: any) {
  if (val == null) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const t = Date.parse(val);
    if (!Number.isNaN(t)) return t;
    return val.toLowerCase();
  }
  if (typeof val === "number" || typeof val === "boolean") return val;
  return val;
}

function normalizeString(val: any) {
  if (val == null) return "";
  return String(val).toLowerCase();
}

function toDateMs(val: any): number | null {
  if (val == null) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "string") {
    const t = Date.parse(val);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function durationMs(amount: number, unit: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const u = String(unit || "").toLowerCase();
  if (u.startsWith("sec")) return n * 1000;
  if (u.startsWith("min")) return n * 60 * 1000;
  if (u.startsWith("hour") || u.startsWith("hr")) return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

function toCents(input: any): number | null {
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normalizeMoneyRuleValue(value: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((v) => toCents(v)).filter((v) => typeof v === "number");
  }
  if (typeof value === "object") {
    const from = toCents((value as any)?.from ?? (value as any)?.min ?? (value as any)?.start);
    const to = toCents((value as any)?.to ?? (value as any)?.max ?? (value as any)?.end);
    return {
      ...(typeof from === "number" ? { from } : {}),
      ...(typeof to === "number" ? { to } : {})
    };
  }
  return toCents(value);
}

function evalRule(rule: SmartListRule, ctx: Record<string, any>): boolean {
  if (!rule) return true;
  if ("rules" in rule) {
    const items = Array.isArray(rule.rules) ? rule.rules : [];
    if (rule.op === "or") return items.some((r) => evalRule(r, ctx));
    return items.every((r) => evalRule(r, ctx));
  }

  const field = String(rule.field || "").trim();
  const op = rule.op;
  if (!field) return true;

  let val: any;
  if (field.startsWith("metadata.")) val = getByPath(ctx.metadata, field.replace(/^metadata\./, ""));
  else if (field.startsWith("subscription.metadata.")) val = getByPath(ctx.subscriptionMeta, field.replace(/^subscription\.metadata\./, ""));
  else val = ctx[field];

  if (op === "exists") return val != null;
  if (op === "isEmpty") return val == null || String(val).trim() === "";

  const isMoneyField = field === "planPrice";
  const ruleValue = isMoneyField ? normalizeMoneyRuleValue(rule.value) : rule.value;
  const cmpVal = toComparable(val);
  const target = toComparable(ruleValue);

  if (op === "equals") return cmpVal === target;
  if (op === "contains") return normalizeString(cmpVal).includes(normalizeString(target));
  if (op === "startsWith") return normalizeString(cmpVal).startsWith(normalizeString(target));
  if (op === "endsWith") return normalizeString(cmpVal).endsWith(normalizeString(target));
  if (op === "in") return Array.isArray(ruleValue) && ruleValue.map(toComparable).includes(cmpVal as any);
  if (op === "notIn") return Array.isArray(ruleValue) && !ruleValue.map(toComparable).includes(cmpVal as any);
  if (op === "gt") return (cmpVal as any) > (target as any);
  if (op === "gte") return (cmpVal as any) >= (target as any);
  if (op === "lt") return (cmpVal as any) < (target as any);
  if (op === "lte") return (cmpVal as any) <= (target as any);
  if (op === "between" && typeof cmpVal === "number") {
    const from = Number((ruleValue as any)?.from ?? (Array.isArray(ruleValue) ? ruleValue[0] : null));
    const to = Number((ruleValue as any)?.to ?? (Array.isArray(ruleValue) ? ruleValue[1] : null));
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    return cmpVal >= from && cmpVal <= to;
  }
  if (op === "before" || op === "after" || op === "between" || op === "within_last" || op === "within_next" || op === "older_than" || op === "newer_than") {
    const valMs = toDateMs(val);
    if (valMs == null) return false;
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
      const from = toDateMs((rule.value as any)?.from ?? (Array.isArray(rule.value) ? rule.value[0] : null));
      const to = toDateMs((rule.value as any)?.to ?? (Array.isArray(rule.value) ? rule.value[1] : null));
      if (from == null || to == null) return false;
      return valMs >= from && valMs <= to;
    }
    const amount = Number((rule.value as any)?.amount ?? (rule.value as any)?.value ?? 0);
    const unit = String((rule.value as any)?.unit ?? "days");
    const ms = durationMs(amount, unit);
    if (ms <= 0) return false;
    if (op === "within_last") return valMs >= now - ms && valMs <= now;
    if (op === "within_next") return valMs >= now && valMs <= now + ms;
    if (op === "older_than") return valMs <= now - ms;
    if (op === "newer_than") return valMs >= now - ms;
  }
  return false;
}

export async function computeSmartListRecipients(rules: SmartListRule) {
  const [customers, approvedCounts, paymentCounts, gamificationScores] = await Promise.all([
    prisma.customer.findMany({
      include: {
        subscriptions: {
          include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
          orderBy: { createdAt: "desc" }
        },
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        tenantLinks: true
      }
    }),
    prisma.payment.groupBy({
      by: ["customerId"],
      where: { status: PaymentStatus.APPROVED },
      _count: { _all: true }
    }),
    prisma.payment.groupBy({
      by: ["customerId"],
      _count: { _all: true }
    }),
    prisma.gamificationScore.findMany({
      where: { entityType: GamificationEntityType.CUSTOMER, tenantId: null }
    })
  ]);

  const approvedByCustomer = new Map<string, number>();
  approvedCounts.forEach((row) => approvedByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));
  const paymentsByCustomer = new Map<string, number>();
  paymentCounts.forEach((row) => paymentsByCustomer.set(String(row.customerId), Number(row._count?._all || 0)));
  const gamificationByCustomer = new Map<string, any>();
  gamificationScores.forEach((row) => gamificationByCustomer.set(String(row.entityId), row));

  const now = Date.now();
  const latestSubscriptions = customers
    .map((customer: any) => customer.subscriptions?.[0] || null)
    .filter((sub: any) => sub?.plan);
  const billingStateBySubscription = await buildSubscriptionBillingStateIndex({
    subscriptions: latestSubscriptions.map((sub: any) => ({
      id: sub.id,
      startAt: sub.startAt,
      cycleStartDay: sub.cycleStartDay,
      paymentDay: sub.paymentDay,
      paymentTiming: (sub.paymentTiming as any) === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO",
      graceDays: sub.graceDays,
      plan: {
        intervalUnit: sub.plan.intervalUnit,
        intervalCount: sub.plan.intervalCount
      }
    })),
    ensureCycles: false
  });

  return customers.filter((customer: any) => {
    const sub = customer.subscriptions?.[0] || null;
    const latestPayment = customer.payments?.[0] || sub?.payments?.[0] || null;
    const approvedCount = approvedByCustomer.get(String(customer.id)) || 0;
    const totalPayments = paymentsByCustomer.get(String(customer.id)) || 0;
    const gamification = gamificationByCustomer.get(String(customer.id));
    const gamificationLevel = Number(gamification?.level || 1);
    const gamificationLevelName = formatLevelName(gamificationLevel);

    const billingState = sub ? billingStateBySubscription.get(String(sub.id)) || null : null;
    const activeCycle = billingState?.activeCycle || null;
    const collectionCycle = billingState?.collectionCycle || activeCycle;
    const nextBillingDate = collectionCycle?.dueAt ? new Date(collectionCycle.dueAt) : activeCycle?.periodEndAt ? new Date(activeCycle.periodEndAt) : null;
    // La mora se mide por el ciclo más antiguo SIN pagar (vencido), no por el
    // collectionCycle (en curso, aún no vencido). Igual que subscriptionQueries.ts.
    const delinquencyCycle =
      billingState?.oldestUnpaidCycle && !isBillingCyclePaid(billingState.oldestUnpaidCycle)
        ? billingState.oldestUnpaidCycle
        : collectionCycle;
    const collectionState = resolveCollectionDelinquency({
      cycle: delinquencyCycle,
      graceDays: sub?.graceDays,
      asOf: new Date(now),
      fallbackSubscriptionStatus: sub?.status ?? null
    });
    const daysPastDue = collectionState.daysPastDue;

    const tier =
      approvedCount >= 6
        ? "Oro"
        : approvedCount >= 3
          ? "Plata"
          : approvedCount >= 1
            ? "Bronce"
            : "Rookie";

    const ctx: Record<string, any> = {
      email: customer.email || "",
      phone: customer.phone || "",
      name: customer.name || "",
      createdAt: customer.createdAt,
      metadata: customer.metadata || {},
      subscriptionMeta: (sub?.metadata ?? {}) as any,
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
      paymentStatusLastApproved: latestPayment?.status === PaymentStatus.APPROVED
    };

    return evalRule(rules, ctx);
  });
}
