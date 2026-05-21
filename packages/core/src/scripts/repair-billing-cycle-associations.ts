import fs from "fs";
import path from "path";
import { BillingCycleStatus, PaymentStatus, type PaymentAssociationReason } from "@prisma/client";
import { prisma } from "../db/prisma";
import { attachPaymentToCycle, ensureBillingCyclesForSubscription, findBestBillingCycleForPayment, resolveCollectionDelinquency, resolveSubscriptionBillingState } from "../services/billingCycles";
import { ensureExpiredSubscriptions } from "../services/subscriptionBilling";
import { classifyReference } from "../webhooks/wompi/classifyReference";
import {
  getExpectedSubscriptionTotalInCents,
  getPlanPricingTotal,
  getSubscriptionPricingTotal
} from "../lib/metadataSchemas";

type CandidatePayment = {
  id: string;
  tenantId: string;
  customerId: string;
  subscriptionId: string | null;
  amountInCents: number;
  currency: string;
  cycleNumber: number | null;
  reference: string;
  paidAt: Date | null;
  createdAt: Date;
  origin: any;
  associationReason: PaymentAssociationReason | null;
  associatedBy: string | null;
  subscriptionCycleKey: string | null;
};

type MutableCycle = {
  id: string;
  cycleNumber: number;
  periodStartAt: Date;
  periodEndAt: Date;
  dueAt: Date;
  paymentId: string | null;
  status: string | null;
};

function envFlag(name: string) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function paymentAt(payment: CandidatePayment) {
  return new Date(payment.paidAt || payment.createdAt);
}

function sortPayments(payments: CandidatePayment[]) {
  return [...payments].sort((a, b) => {
    const diff = paymentAt(a).getTime() - paymentAt(b).getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

function hasSubscriptionPricing(metadata: unknown) {
  return Number.isFinite(getSubscriptionPricingTotal(metadata, Number.NaN));
}

function loadEnvFileIfPresent(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!key || process.env[key] != null) continue;
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function ensureEnvLoaded() {
  if (process.env.DATABASE_URL) return;
  const repoRoot = path.resolve(__dirname, "../../../..");
  loadEnvFileIfPresent(path.join(repoRoot, ".env"));
  loadEnvFileIfPresent(path.join(repoRoot, "apps/admin/.env.local"));
}

function parseCycleHintFromManualReference(reference: string) {
  const match = /^MANUAL_([a-f0-9-]+)_(\d+)_\d+$/i.exec(reference.trim());
  if (!match) return null;
  const cycle = Number(match[2]);
  return Number.isFinite(cycle) ? cycle : null;
}

function parseCycleHint(payment: CandidatePayment) {
  const classified = classifyReference(payment.reference);
  if (classified.kind === "subscription" && classified.cycle != null) return classified.cycle;
  const manualRefCycle = parseCycleHintFromManualReference(payment.reference);
  if (manualRefCycle != null) return manualRefCycle;
  return null;
}

async function loadCandidatePayments(args: {
  subscriptionId: string;
  customerId: string;
  tenantId: string;
  expectedTotalInCents: number;
  currency: string;
}) {
  const existing = await prisma.payment.findMany({
    where: {
      subscriptionId: args.subscriptionId,
      status: PaymentStatus.APPROVED
    },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      subscriptionId: true,
      amountInCents: true,
      currency: true,
      cycleNumber: true,
      reference: true,
      paidAt: true,
      createdAt: true,
      origin: true,
      associationReason: true,
      associatedBy: true,
      subscriptionCycleKey: true
    }
  });

  const byReference = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.APPROVED,
      subscriptionId: null,
      customerId: args.customerId,
      tenantId: args.tenantId,
      reference: { startsWith: `SUB_${args.subscriptionId}_` },
      billingCycle: { is: null }
    },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      subscriptionId: true,
      amountInCents: true,
      currency: true,
      cycleNumber: true,
      reference: true,
      paidAt: true,
      createdAt: true,
      origin: true,
      associationReason: true,
      associatedBy: true,
      subscriptionCycleKey: true
    }
  });

  const exactUnlinked = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.APPROVED,
      subscriptionId: null,
      customerId: args.customerId,
      tenantId: args.tenantId,
      amountInCents: args.expectedTotalInCents,
      currency: args.currency,
      billingCycle: { is: null }
    },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      subscriptionId: true,
      amountInCents: true,
      currency: true,
      cycleNumber: true,
      reference: true,
      paidAt: true,
      createdAt: true,
      origin: true,
      associationReason: true,
      associatedBy: true,
      subscriptionCycleKey: true
    }
  });

  return Array.from(
    new Map([...existing, ...byReference, ...exactUnlinked].map((payment) => [payment.id, payment])).values()
  );
}

function planAssignments(args: {
  cycles: MutableCycle[];
  payments: CandidatePayment[];
}) {
  const candidateIds = new Set(args.payments.map((payment) => payment.id));
  const plannedCycles = args.cycles.map((cycle) => ({
    ...cycle,
    paymentId: candidateIds.has(String(cycle.paymentId || "")) ? null : cycle.paymentId
  }));

  const assignments: Array<{ payment: CandidatePayment; cycle: MutableCycle }> = [];
  const skipped: Array<{ paymentId: string; reason: string }> = [];

  for (const payment of sortPayments(args.payments)) {
    const match = findBestBillingCycleForPayment({
      cycles: plannedCycles,
      paymentAt: paymentAt(payment),
      cycleNumberHint: parseCycleHint(payment),
      toleranceDays: 14
    });

    if (!match) {
      skipped.push({ paymentId: payment.id, reason: "no_open_cycle_match" });
      continue;
    }

    const cycle = plannedCycles.find((item) => item.id === match.id);
    if (!cycle) {
      skipped.push({ paymentId: payment.id, reason: "planned_cycle_missing" });
      continue;
    }

    cycle.paymentId = payment.id;
    cycle.status = BillingCycleStatus.PAID;
    assignments.push({ payment, cycle });
  }

  return { assignments, skipped };
}

async function reconcileSubscriptionStatus(subscriptionId: string) {
  const state = await resolveSubscriptionBillingState({ subscriptionId }).catch(() => null);
  if (!state?.subscription) return;
  const cycle = state.collectionCycle || state.activeCycle || null;
  const delinquency = resolveCollectionDelinquency({
    cycle,
    graceDays: state.subscription.graceDays ?? 0,
    fallbackSubscriptionStatus: state.subscription.status
  });
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: delinquency.status === "EN_MORA" ? "PAST_DUE" : "ACTIVE" }
  });
}

async function main() {
  ensureEnvLoaded();
  const apply = envFlag("APPLY");
  const subscriptionIdFilter = String(process.env.SUBSCRIPTION_ID || "").trim();
  const tenantIdFilter = String(process.env.TENANT_ID || "").trim();
  const limitRaw = Number(process.env.LIMIT || "200");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.trunc(limitRaw))) : 200;

  const subscriptions = await prisma.subscription.findMany({
    where: {
      ...(subscriptionIdFilter ? { id: subscriptionIdFilter } : {}),
      ...(tenantIdFilter ? { tenantId: tenantIdFilter } : {})
    },
    include: {
      plan: {
        select: {
          metadata: true,
          priceInCents: true,
          currency: true,
          intervalUnit: true,
          intervalCount: true
        }
      }
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  const summary = {
    apply,
    scannedSubscriptions: subscriptions.length,
    repairedSubscriptions: 0,
    updatedSubscriptionPricing: 0,
    clearedCycleLinks: 0,
    attachedPayments: 0,
    updatedPayments: 0,
    skippedPayments: 0,
    skippedSubscriptions: 0
  };

  for (const subscription of subscriptions) {
    if (!subscription.plan) {
      summary.skippedSubscriptions += 1;
      continue;
    }

    await ensureBillingCyclesForSubscription({
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
    });

    const expectedTotalInCents = getExpectedSubscriptionTotalInCents({
      subscriptionMetadata: subscription.metadata,
      planMetadata: subscription.plan.metadata,
      fallback: subscription.plan.priceInCents
    });
    const currency = String(subscription.plan.currency || "COP").trim().toUpperCase() || "COP";

    const cycles = await prisma.subscriptionBillingCycle.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: [{ cycleNumber: "asc" }],
      select: {
        id: true,
        cycleNumber: true,
        periodStartAt: true,
        periodEndAt: true,
        dueAt: true,
        paymentId: true,
        status: true
      }
    });

    const candidatePayments = await loadCandidatePayments({
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      tenantId: subscription.tenantId,
      expectedTotalInCents,
      currency
    });

    const { assignments, skipped } = planAssignments({
      cycles: cycles.map((cycle) => ({
        id: cycle.id,
        cycleNumber: cycle.cycleNumber,
        periodStartAt: cycle.periodStartAt,
        periodEndAt: cycle.periodEndAt,
        dueAt: cycle.dueAt,
        paymentId: cycle.paymentId,
        status: cycle.status
      })),
      payments: candidatePayments
    });

    summary.skippedPayments += skipped.length;

    const plannedByPaymentId = new Map(assignments.map((item) => [item.payment.id, item]));
    const candidatePaymentIds = new Set(candidatePayments.map((payment) => payment.id));
    const cyclesToClear = cycles.filter((cycle) => {
      if (!cycle.paymentId || !candidatePaymentIds.has(cycle.paymentId)) return false;
      const desired = plannedByPaymentId.get(cycle.paymentId);
      return !desired || desired.cycle.id !== cycle.id;
    });

    const paymentsToUpdate = assignments.filter(({ payment, cycle }) => {
      const desiredKey = `${subscription.id}:${cycle.cycleNumber}`;
      const desiredCycleHint = cycle.cycleNumber;
      return (
        payment.subscriptionId !== subscription.id ||
        payment.cycleNumber !== desiredCycleHint ||
        payment.subscriptionCycleKey !== desiredKey ||
        payment.customerId !== subscription.customerId ||
        payment.tenantId !== subscription.tenantId
      );
    });

    const needsPricingRepair =
      !hasSubscriptionPricing(subscription.metadata) &&
      Number.isFinite(getPlanPricingTotal(subscription.plan.metadata, Number.NaN));

    const touched = cyclesToClear.length > 0 || assignments.length > 0 || paymentsToUpdate.length > 0 || needsPricingRepair;
    if (!touched) continue;

    summary.repairedSubscriptions += 1;

    if (!apply) {
      console.log(
        JSON.stringify(
          {
            subscriptionId: subscription.id,
            expectedTotalInCents,
            candidatePayments: candidatePayments.length,
            cyclesToClear: cyclesToClear.map((cycle) => ({ cycleId: cycle.id, cycleNumber: cycle.cycleNumber, paymentId: cycle.paymentId })),
            assignments: assignments.map(({ payment, cycle }) => ({
              paymentId: payment.id,
              fromCycleNumber: payment.cycleNumber,
              toCycleNumber: cycle.cycleNumber,
              amountInCents: payment.amountInCents,
              reference: payment.reference
            })),
            skipped
          },
          null,
          2
        )
      );
      continue;
    }

    if (needsPricingRepair) {
      const currentMeta = subscription.metadata && typeof subscription.metadata === "object" ? (subscription.metadata as Record<string, unknown>) : {};
      const planMeta = subscription.plan.metadata && typeof subscription.plan.metadata === "object" ? (subscription.plan.metadata as Record<string, unknown>) : {};
      const nextPricing =
        planMeta.pricing && typeof planMeta.pricing === "object"
          ? (planMeta.pricing as Record<string, unknown>)
          : { totalInCents: expectedTotalInCents, currency };
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          metadata: {
            ...currentMeta,
            pricing: nextPricing
          } as any
        }
      });
      summary.updatedSubscriptionPricing += 1;
    }

    for (const cycle of cyclesToClear) {
      await prisma.subscriptionBillingCycle.update({
        where: { id: cycle.id },
        data: {
          paymentId: null,
          paidAt: null,
          paidOnTime: null,
          daysEarly: null,
          daysLate: null,
          origin: null,
          associationReason: null,
          associatedBy: null,
          status: BillingCycleStatus.PENDING
        }
      });
      summary.clearedCycleLinks += 1;
    }

    for (const { payment, cycle } of assignments) {
      const desiredKey = `${subscription.id}:${cycle.cycleNumber}`;
      const conflicting = await prisma.payment.findUnique({
        where: { subscriptionCycleKey: desiredKey },
        select: { id: true }
      });
      if (conflicting?.id && conflicting.id !== payment.id) {
        summary.skippedPayments += 1;
        console.warn(
          JSON.stringify({
            subscriptionId: subscription.id,
            paymentId: payment.id,
            desiredKey,
            conflictPaymentId: conflicting.id,
            reason: "subscription_cycle_key_conflict"
          })
        );
        continue;
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          tenantId: subscription.tenantId,
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          cycleNumber: cycle.cycleNumber,
          subscriptionCycleKey: desiredKey,
          associationReason:
            payment.associationReason ||
            (classifyReference(payment.reference).kind === "subscription" ? "SUB_REF" : "MANUAL_RECONCILE"),
          associatedBy: payment.associatedBy || "repair-billing-cycle-associations"
        }
      });
      summary.updatedPayments += 1;

      await attachPaymentToCycle({
        paymentId: payment.id,
        subscriptionId: subscription.id,
        cycleId: cycle.id,
        paymentAt: paymentAt(payment),
        origin: payment.origin,
        associationReason:
          (payment.associationReason ||
            (classifyReference(payment.reference).kind === "subscription" ? "SUB_REF" : "MANUAL_RECONCILE")) as PaymentAssociationReason,
        associatedBy: payment.associatedBy || "repair-billing-cycle-associations"
      });
      summary.attachedPayments += 1;
    }

    await reconcileSubscriptionStatus(subscription.id);
  }

  if (apply) {
    await ensureExpiredSubscriptions();
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
