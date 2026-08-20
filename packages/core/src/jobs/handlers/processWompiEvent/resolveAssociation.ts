/**
 * Step 3: Resolve subscription association by scoring identity + references.
 * FIX #4: Extracted from the monolithic processWompiEventLogic.
 */

import { PaymentAssociationReason } from "@prisma/client";
import type { prisma } from "../../../db/prisma";
import { logger } from "../../../lib/logger";
import { getExpectedSubscriptionTotalInCents } from "../../../lib/metadataSchemas";
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

  // Match by phone.
  // Sin paginar: los teléfonos se guardan con formatos mezclados ("3104362040",
  // "+573104362040", "321 8123241"), así que la comparación tiene que hacerse sobre
  // los dígitos normalizados. Limitar la consulta a los N clientes más recientes
  // dejaba fuera al titular de la suscripción y el pago quedaba sin asociar.
  if (args.phone) {
    const byPhone = await args.db.customer.findMany({
      where: { phone: { not: null }, ...tenantScope },
      select: { id: true, phone: true }
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

  // Compute expected amounts using the same path as createPaymentLinkForSubscription:
  // subscription.metadata.pricing.totalInCents → plan.metadata.pricing.totalInCents → plan.priceInCents
  // This ensures shipping stored in plan metadata is included.
  type CandidateWithAmounts = { sub: any; expectedTotal: number; planCurrency: string };
  const candidatesWithAmounts: CandidateWithAmounts[] = candidates
    .filter((s: any) => {
      const planCurrency = String(s?.plan?.currency || "").trim().toUpperCase();
      return !(incomingCurrency && planCurrency && incomingCurrency !== planCurrency);
    })
    .map((s: any) => ({
      sub: s,
      expectedTotal: getExpectedSubscriptionTotalInCents({
        subscriptionMetadata: s.metadata,
        planMetadata: s.plan?.metadata,
        fallback: s.plan?.priceInCents || 0
      }),
      planCurrency: String(s?.plan?.currency || "").trim().toUpperCase()
    }));

  // Tier 1: exact amount match
  const withExactAmount = candidatesWithAmounts.filter(({ expectedTotal }) => expectedTotal === incomingAmount);

  const score = identitySource === "name" ? 70 : 80;

  if (withExactAmount.length === 1) {
    const { sub } = withExactAmount[0];
    return {
      subscriptionId: sub.id,
      customerId: sub.customerId ?? undefined,
      score,
      reason: "IDENTITY_MATCH" as any,
      criteria: { method: "identity", source: identitySource, amountInCents: incomingAmount, currency: incomingCurrency || null }
    };
  }

  if (withExactAmount.length > 1) {
    logger.warn(
      { tenantId: args.tenantId || null, customerIds: Array.from(customerIds), subscriptionIds: withExactAmount.map(({ sub }) => sub.id), amountInCents: incomingAmount, source: identitySource },
      "resolveAssociation: coincidencia ambigua por identidad+monto; se omite autoasignacion"
    );
    return null;
  }

  // Tier 2: no exact match — try active subscriptions only (status ACTIVE or PAST_DUE)
  const activeOnly = candidatesWithAmounts.filter(({ sub }) => sub.status === "ACTIVE" || sub.status === "PAST_DUE");

  // If there's exactly one active subscription for this customer, associate it with lower
  // confidence — amount mismatch is often caused by shipping costs that changed or were stored
  // separately in plan vs subscription metadata.
  if (activeOnly.length === 1) {
    const { sub, expectedTotal } = activeOnly[0];
    logger.warn(
      {
        tenantId: args.tenantId || null,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        incomingAmount,
        expectedAmount: expectedTotal,
        currency: incomingCurrency || null,
        source: identitySource
      },
      "resolveAssociation: asociando por identidad con diferencia de monto (posible flete)"
    );
    return {
      subscriptionId: sub.id,
      customerId: sub.customerId ?? undefined,
      score: identitySource === "name" ? 55 : 65,
      reason: "IDENTITY_MATCH" as any,
      criteria: {
        method: "identity_amount_mismatch",
        source: identitySource,
        incomingAmount,
        expectedAmount: expectedTotal,
        currency: incomingCurrency || null
      }
    };
  }

  if (activeOnly.length > 1) {
    logger.warn(
      { tenantId: args.tenantId || null, customerIds: Array.from(customerIds), subscriptionIds: activeOnly.map(({ sub }) => sub.id), amountInCents: incomingAmount, source: identitySource },
      "resolveAssociation: multiples suscripciones activas sin coincidencia exacta de monto; se omite autoasignacion"
    );
  }

  return null;
}

/**
 * Find the oldest unpaid cycle for a subscription (used for identity match fallback).
 */
export async function findOldestUnpaidCycle(args: {
  db: typeof prisma;
  subscriptionId: string;
  startAt?: Date | null;
  currentCycle?: number | null;
  currentPeriodStartAt?: Date | null;
  currentPeriodEndAt?: Date | null;
  cycleStartDay: number;
  paymentDay: number;
  paymentTiming?: string | null;
  graceDays: number;
  plan: { intervalUnit: string; intervalCount: number };
}) {
  await ensureBillingCyclesForSubscriptions([buildBillingSeed({
    id: args.subscriptionId,
    startAt: args.startAt,
    currentCycle: args.currentCycle,
    currentPeriodStartAt: args.currentPeriodStartAt,
    currentPeriodEndAt: args.currentPeriodEndAt,
    cycleStartDay: args.cycleStartDay,
    paymentDay: args.paymentDay,
    paymentTiming: args.paymentTiming,
    graceDays: args.graceDays,
    plan: { intervalUnit: args.plan.intervalUnit as any, intervalCount: args.plan.intervalCount }
  })]).catch((err) => {
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
