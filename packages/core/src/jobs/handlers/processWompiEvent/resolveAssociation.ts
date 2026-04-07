/**
 * Step 3: Resolve subscription association by scoring identity + references.
 * FIX #4: Extracted from the monolithic processWompiEventLogic.
 */

import { BillingCycleStatus, PaymentAssociationReason } from "@prisma/client";
import type { prisma } from "../../../db/prisma";
import { logger } from "../../../lib/logger";
import { ensureBillingCyclesForSubscriptions } from "../../../services/billingCycles";
import { getSubscriptionPricingTotal } from "../../../lib/metadataSchemas";
import { classifyReference } from "../../../webhooks/wompi/classifyReference";
import type { AssociationDecision } from "./types";

function normalizePhoneDigits(value: unknown): string {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("57") && digits.length > 10) return digits.slice(-10);
  return digits;
}

export function phonesMatch(a: unknown, b: unknown): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return da.length >= 8 && db.length >= 8 && (da.endsWith(db) || db.endsWith(da));
}

function normalizeNameForMatch(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Resolve subscription for a payment by scoring identity + reference matches.
 * Returns the most likely subscription association.
 */
export async function resolveAssociationByScore(args: {
  db: typeof prisma;
  tenantId?: string | null;
  amountInCents?: number | null;
  currency?: string | null;
  matchReason?: PaymentAssociationReason | null;
  paymentMatched?: { subscriptionId?: string | null; customerId?: string | null; cycleNumber?: number | null } | null;
  paymentLinkRecord?: { subscriptionId?: string | null } | null;
  referenceClassification: ReturnType<typeof classifyReference>;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<AssociationDecision | null> {
  const directSubscriptionId =
    args.paymentMatched?.subscriptionId ||
    args.paymentLinkRecord?.subscriptionId ||
    (args.referenceClassification.kind === "subscription" ? args.referenceClassification.subscriptionId : "");

  // Direct match: payment already linked to a subscription
  if (directSubscriptionId) {
    if (args.referenceClassification.kind === "subscription" && args.referenceClassification.subscriptionId) {
      const exists = await args.db.subscription.findUnique({
        where: { id: args.referenceClassification.subscriptionId },
        select: { id: true, customerId: true }
      });
      if (!exists) return null;
      return {
        subscriptionId: exists.id,
        customerId: exists.customerId ?? undefined,
        score: 100,
        reason: (args.matchReason || "SUB_REF") as any,
        criteria: {
          method: args.matchReason || "SUB_REF",
          referenceKind: args.referenceClassification.kind
        },
        cycleNumber: args.referenceClassification.cycle ?? args.paymentMatched?.cycleNumber ?? null
      };
    }
    return {
      subscriptionId: directSubscriptionId,
      customerId: args.paymentMatched?.customerId ?? undefined,
      score: 100,
      reason: (args.matchReason || "UNKNOWN") as any,
      criteria: { method: args.matchReason || "UNKNOWN" },
      cycleNumber: args.paymentMatched?.cycleNumber ?? null
    };
  }

  // Identity-based matching requires an amount
  const incomingAmount = Number(args.amountInCents || 0);
  if (!incomingAmount) return null;
  const incomingCurrency = String(args.currency || "").trim().toUpperCase();

  const tenantScope = args.tenantId ? { tenantId: args.tenantId } : {};
  const customerIds = new Set<string>();
  let identitySource: "email" | "phone" | "name" | "email_phone" | null = null;

  // Match by email
  if (args.email) {
    const byEmail = await args.db.customer.findMany({
      where: { email: args.email, ...tenantScope },
      select: { id: true }
    });
    if (byEmail.length) identitySource = "email";
    byEmail.forEach((c) => customerIds.add(c.id));
  }

  // Match by phone
  if (args.phone) {
    const byPhone = await args.db.customer.findMany({
      where: { phone: { not: null }, ...tenantScope },
      select: { id: true, phone: true },
      orderBy: { updatedAt: "desc" },
      take: 500
    });
    const matched = byPhone.filter((c) => phonesMatch(c.phone, args.phone));
    if (matched.length) identitySource = identitySource ? "email_phone" : "phone";
    matched.forEach((c) => customerIds.add(c.id));
  }

  // Match by name (lower confidence)
  if (!customerIds.size) {
    const nameNorm = normalizeNameForMatch(args.name);
    if (nameNorm.length >= 4) {
      const byName = await args.db.customer.findMany({
        where: { name: { contains: String(args.name || "").trim(), mode: "insensitive" }, ...tenantScope },
        select: { id: true, name: true },
        orderBy: { updatedAt: "desc" },
        take: 100
      });
      const matched = byName.filter((c) => normalizeNameForMatch(c.name) === nameNorm);
      if (matched.length) identitySource = "name";
      matched.forEach((c) => customerIds.add(c.id));
    }
  }

  if (!customerIds.size || !identitySource) return null;

  // Find subscriptions for matched customers with plan pricing
  const candidates = await args.db.subscription.findMany({
    where: {
      customerId: { in: Array.from(customerIds) },
      ...(args.tenantId ? { tenantId: args.tenantId } : {})
    },
    include: {
      plan: {
        select: { priceInCents: true, currency: true, metadata: true, intervalUnit: true, intervalCount: true }
      }
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  // Filter by exact amount match
  const withExactAmount = candidates.filter((s: any) => {
    const planAmount = getSubscriptionPricingTotal(s?.metadata, s?.plan?.priceInCents || 0);
    const planCurrency = String(s?.plan?.currency || "").trim().toUpperCase();
    if (!incomingAmount) return false;
    if (incomingCurrency && planCurrency && incomingCurrency !== planCurrency) return false;
    return planAmount === incomingAmount;
  });

  if (!withExactAmount.length) return null;

  const score = identitySource === "name" ? 70 : 80;

  // Single match — return it
  if (withExactAmount.length === 1) {
    const winner = withExactAmount[0];
    return {
      subscriptionId: winner.id,
      customerId: winner.customerId ?? undefined,
      score,
      reason: "IDENTITY_MATCH" as any,
      criteria: {
        method: "identity",
        source: identitySource,
        amountInCents: incomingAmount,
        currency: incomingCurrency || null
      }
    };
  }

  // Multiple matches — tie-break by oldest unpaid cycle
  await ensureBillingCyclesForSubscriptions(
    withExactAmount.map((sub: any) => ({
      id: sub.id,
      currentCycle: sub.currentCycle,
      currentPeriodStartAt: sub.currentPeriodStartAt,
      currentPeriodEndAt: sub.currentPeriodEndAt,
      cycleStartDay: sub.cycleStartDay,
      paymentDay: sub.paymentDay,
      paymentTiming: (sub.paymentTiming as any) || "EN_CURSO",
      graceDays: sub.graceDays,
      plan: { intervalUnit: sub.plan?.intervalUnit as any, intervalCount: sub.plan?.intervalCount }
    }))
  ).catch((err) => {
    logger.warn({ err, subscriptionIds: withExactAmount.map((sub: any) => sub.id) }, "resolveAssociation: fallo asegurando ciclos para desempate");
  });

  const oldestCycles = await args.db.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId: { in: withExactAmount.map((sub: any) => sub.id) },
      paymentId: null,
      status: { not: BillingCycleStatus.PAID }
    },
    orderBy: [{ dueAt: "asc" }, { periodStartAt: "asc" }, { cycleNumber: "asc" }],
    take: 1
  });
  const oldest = oldestCycles[0];
  if (!oldest) return null;

  const winner = withExactAmount.find((sub: any) => sub.id === oldest.subscriptionId);
  if (!winner) return null;

  return {
    subscriptionId: winner.id,
    customerId: winner.customerId ?? undefined,
    score,
    reason: "IDENTITY_MATCH" as any,
    criteria: {
      method: "identity",
      source: identitySource,
      amountInCents: incomingAmount,
      currency: incomingCurrency || null,
      tieBreak: "oldest_unpaid_cycle"
    },
    cycleNumber: oldest.cycleNumber
  };
}

/**
 * Find the oldest unpaid cycle for a subscription (used for identity match fallback).
 */
export async function findOldestUnpaidCycle(args: {
  db: typeof prisma;
  subscriptionId: string;
  currentCycle: number;
  currentPeriodStartAt: Date;
  currentPeriodEndAt: Date;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming: string;
  graceDays: number;
  plan: { intervalUnit: string; intervalCount: number };
}) {
  await ensureBillingCyclesForSubscriptions([{
    id: args.subscriptionId,
    currentCycle: args.currentCycle,
    currentPeriodStartAt: args.currentPeriodStartAt,
    currentPeriodEndAt: args.currentPeriodEndAt,
    cycleStartDay: args.cycleStartDay,
    paymentDay: args.paymentDay,
    paymentTiming: (args.paymentTiming as any) || "EN_CURSO",
    graceDays: args.graceDays,
    plan: { intervalUnit: args.plan.intervalUnit as any, intervalCount: args.plan.intervalCount }
  }]).catch((err) => {
    logger.warn({ err, subscriptionId: args.subscriptionId }, "findOldestUnpaidCycle: fallo asegurando ciclos");
  });

  const cycles = await args.db.subscriptionBillingCycle.findMany({
    where: {
      subscriptionId: args.subscriptionId,
      paymentId: null,
      status: { not: BillingCycleStatus.PAID }
    },
    orderBy: [{ cycleNumber: "asc" }]
  });
  return cycles[0] ?? null;
}
