import { prisma } from "../db/prisma";
import { SubscriptionStatus, PaymentStatus } from "@prisma/client";

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

  const cmpVal = toComparable(val);
  const target = toComparable(rule.value);

  if (op === "equals") return cmpVal === target;
  if (op === "contains") return normalizeString(cmpVal).includes(normalizeString(target));
  if (op === "startsWith") return normalizeString(cmpVal).startsWith(normalizeString(target));
  if (op === "endsWith") return normalizeString(cmpVal).endsWith(normalizeString(target));
  if (op === "in") return Array.isArray(rule.value) && rule.value.map(toComparable).includes(cmpVal as any);
  if (op === "notIn") return Array.isArray(rule.value) && !rule.value.map(toComparable).includes(cmpVal as any);
  if (op === "gt") return (cmpVal as any) > (target as any);
  if (op === "gte") return (cmpVal as any) >= (target as any);
  if (op === "lt") return (cmpVal as any) < (target as any);
  if (op === "lte") return (cmpVal as any) <= (target as any);
  return false;
}

export async function computeSmartListRecipients(rules: SmartListRule) {
  const customers = await prisma.customer.findMany({
    include: {
      subscriptions: {
        include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" }
      },
      payments: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  const now = Date.now();

  return customers.filter((customer) => {
    const sub = customer.subscriptions?.[0] || null;
    const latestPayment = customer.payments?.[0] || sub?.payments?.[0] || null;

    const currentPeriodEndAt = sub?.currentPeriodEndAt ? new Date(sub.currentPeriodEndAt) : null;
    const daysPastDue =
      currentPeriodEndAt && currentPeriodEndAt.getTime() < now
        ? Math.floor((now - currentPeriodEndAt.getTime()) / 86_400_000)
        : 0;

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
      nextBillingDate: currentPeriodEndAt,
      lastPaymentStatus: latestPayment?.status ?? null,
      lastPaymentDate: latestPayment?.createdAt ?? null,
      daysPastDue,
      inMora: sub?.status === SubscriptionStatus.PAST_DUE || daysPastDue > 0,
      hasSubscription: !!sub,
      paymentStatusLastApproved: latestPayment?.status === PaymentStatus.APPROVED
    };

    return evalRule(rules, ctx);
  });
}
