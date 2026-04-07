/**
 * GET /api/billing/cycle-candidates
 *
 * Returns pending billing cycles with matching unlinked payments
 * for auto-association review.
 */

import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { prisma } from "@suscripciones/database";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiSession(req).catch(() => null);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const subscriptionId = url.searchParams.get("subscriptionId");
  if (!subscriptionId) {
    return NextResponse.json({ error: "subscriptionId required" }, { status: 400 });
  }

  // 1. Load subscription with pending cycles
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: { select: { priceInCents: true, currency: true, name: true } },
      customer: { select: { id: true, name: true, email: true, phone: true } },
      billingCycles: {
        where: { status: { in: ["PENDING", "FAILED"] } },
        orderBy: [{ cycleNumber: "asc" }]
      }
    }
  });

  if (!sub) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }

  const pendingCycles = sub.billingCycles;
  if (!pendingCycles.length) {
    return NextResponse.json({ ok: true, subscriptionId, candidates: [], message: "no_pending_cycles" });
  }

  // 2. Find unlinked/approved payments for this customer
  const unlinkedPayments = await prisma.payment.findMany({
    where: {
      customerId: sub.customerId,
      status: "APPROVED",
      OR: [
        { subscriptionId: null },
        { subscriptionId: subscriptionId, billingCycle: { is: null } }
      ]
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      amountInCents: true,
      currency: true,
      status: true,
      paidAt: true,
      createdAt: true,
      reference: true,
      wompiTransactionId: true,
      origin: true,
      associationReason: true,
      cycleNumber: true
    }
  });

  // 3. Score each payment against each pending cycle
  const candidates: Array<{
    cycle: Record<string, any>;
    payment: Record<string, any>;
    score: number;
    reasons: string[];
  }> = [];

  for (const cycle of pendingCycles) {
    const periodStartMs = new Date(cycle.periodStartAt).getTime();
    const periodEndMs = new Date(cycle.periodEndAt).getTime();
    const dueAtMs = new Date(cycle.dueAt).getTime();
    const planAmount = sub.plan?.priceInCents || 0;
    const planCurrency = (sub.plan?.currency || "COP").toUpperCase();

    // Tolerance: 7 days before period start, 15 days after period end
    const toleranceBefore = 7 * 24 * 60 * 60 * 1000;
    const toleranceAfter = 15 * 24 * 60 * 60 * 1000;

    for (const payment of unlinkedPayments) {
      const paidAtMs = payment.paidAt ? new Date(payment.paidAt).getTime() : new Date(payment.createdAt).getTime();
      if (!Number.isFinite(paidAtMs)) continue;

      let score = 0;
      const reasons: string[] = [];

      // Amount match: MUST BE EXACT — no tolerance
      if (payment.amountInCents !== planAmount) continue;
      score += 60;
      reasons.push("monto_exact");

      // Currency match
      if ((payment.currency || "COP").toUpperCase() === planCurrency) {
        score += 10;
      }

      // Date range match (within cycle period ± tolerance)
      const windowStart = periodStartMs - toleranceBefore;
      const windowEnd = periodEndMs + toleranceAfter;
      if (paidAtMs >= windowStart && paidAtMs <= windowEnd) {
        score += 30;
        reasons.push("en_rango");

        // Bonus: payment is close to due date
        const daysFromDue = Math.abs(paidAtMs - dueAtMs) / (24 * 60 * 60 * 1000);
        if (daysFromDue <= 3) {
          score += 10;
          reasons.push("cerca_del_vencimiento");
        }
      }

      // Reference match
      if (payment.reference && payment.reference.includes(subscriptionId)) {
        score += 40;
        reasons.push("referencia_coincide");
      }

      // Only include if score is meaningful
      if (score >= 50) {
        candidates.push({
          cycle: {
            id: cycle.id,
            cycleNumber: cycle.cycleNumber,
            periodStartAt: cycle.periodStartAt.toISOString(),
            periodEndAt: cycle.periodEndAt.toISOString(),
            dueAt: cycle.dueAt.toISOString(),
            status: cycle.status
          },
          payment: {
            id: payment.id,
            amountInCents: payment.amountInCents,
            currency: payment.currency,
            status: payment.status,
            paidAt: payment.paidAt?.toISOString() || null,
            createdAt: payment.createdAt.toISOString(),
            reference: payment.reference,
            wompiTransactionId: payment.wompiTransactionId,
            origin: payment.origin,
            cycleNumber: payment.cycleNumber
          },
          score,
          reasons
        });
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    ok: true,
    subscriptionId,
    pendingCyclesCount: pendingCycles.length,
    unlinkedPaymentsCount: unlinkedPayments.length,
    candidates
  });
}
