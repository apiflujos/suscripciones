import { LogLevel } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { systemLog } from "./systemLog";
import { buildBillingSeed, ensureBillingCyclesForSubscriptions, findBestBillingCycleForPayment, resolveSubscriptionBillingState } from "./billingCycles";

/**
 * Asocia un pago aprobado a una suscripción, al ciclo que le toca por fecha (o al
 * que se indique). Es la asociación manual de siempre: la usan la pantalla de
 * Pagos, la de asociar en lote y la asociación automática del worker.
 */
export async function associatePaymentToSubscription(args: {
  paymentId?: string;
  subscriptionId?: string;
  cycleId?: string;
  tenantId?: string;
  actorEmail?: string;
}) {
  const paymentId = String(args.paymentId || "").trim();
  const subscriptionId = String(args.subscriptionId || "").trim();
  const cycleId = String(args.cycleId || "").trim();
  const tenantIdFromBody = String(args.tenantId || "").trim();
  if (!paymentId || (!subscriptionId && !cycleId)) return { ok: false as const, error: "missing_ids" as const };

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { ok: false as const, error: "payment_not_found" as const };

  let subscription = null as any;
  let cycle = null as any;
  if (cycleId) {
    cycle = await prisma.subscriptionBillingCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) return { ok: false as const, error: "cycle_not_found" as const };
    subscription = await prisma.subscription.findUnique({
      where: { id: cycle.subscriptionId },
      include: { plan: true, customer: true }
    });
  } else {
    subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, customer: true }
    });
  }
  if (!subscription) return { ok: false as const, error: "subscription_not_found" as const };

  const tenantId = tenantIdFromBody || String(payment.tenantId || "").trim();
  if (tenantId && String(subscription.tenantId || "").trim() !== tenantId) {
    return { ok: false as const, error: "tenant_mismatch" as const };
  }
  if (!["ACTIVE", "PAST_DUE"].includes(String(subscription.status || "").toUpperCase())) {
    return { ok: false as const, error: "subscription_inactive" as const };
  }

  const paymentAt = payment.paidAt || payment.createdAt;
  const toleranceDays = 7;
  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;

  await ensureBillingCyclesForSubscriptions([
    buildBillingSeed({
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
    })
  ]).catch((err: any) => {
    logger.warn({ err, subscriptionId: subscription.id, paymentId: payment.id }, "Fallo asegurando ciclos antes de asociar pago manual");
  });

  const now = new Date();
  const billingState = await resolveSubscriptionBillingState({ subscriptionId: subscription.id, asOf: now }).catch(() => null);
  const activeCycle = billingState?.activeCycle || null;
  let cycleToAttach = cycle;
  if (!cycleToAttach) {
    const openCycles = await prisma.subscriptionBillingCycle.findMany({
      where: {
        subscriptionId: subscription.id,
        paymentId: null,
        status: { not: "PAID" }
      },
      orderBy: [{ dueAt: "asc" }, { cycleNumber: "asc" }]
    });
    cycleToAttach = findBestBillingCycleForPayment({
      cycles: openCycles,
      paymentAt,
      toleranceDays: 7
    });
  }
  if (!cycleToAttach) {
    cycleToAttach = await prisma.subscriptionBillingCycle.findUnique({
      where: { subscriptionId_cycleNumber: { subscriptionId: subscription.id, cycleNumber: activeCycle?.cycleNumber ?? 1 } }
    });
  }
  if (cycleToAttach?.paymentId && cycleToAttach.paymentId !== payment.id) {
    return {
      ok: false as const,
      error: "cycle_already_has_payment" as const
    };
  }

  // La llave `suscripción:ciclo` es única y la reservan los pagos que el sistema
  // abre para ese ciclo (un link o un cobro pendiente). Si otro pago ya la tiene,
  // este se asocia igual al ciclo, pero sin reclamarla: pelearla tumbaba la
  // asociación de un pago que el cliente sí hizo.
  const cycleKeyFor = async (cycleNumber: number | null | undefined) => {
    if (!cycleNumber) return null;
    const key = `${subscription.id}:${cycleNumber}`;
    const holder = await prisma.payment.findFirst({
      where: { subscriptionCycleKey: key, id: { not: payment.id } },
      select: { id: true }
    });
    return holder ? null : key;
  };

  if (cycleToAttach) {
    const claimKey = await cycleKeyFor(cycleToAttach.cycleNumber);
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        cycleNumber: cycleToAttach.cycleNumber,
        ...(claimKey ? { subscriptionCycleKey: claimKey } : {})
      }
    }).catch((err: any) => {
      logger.warn({ err, paymentId: payment.id, subscriptionId: subscription.id, cycleId: cycleToAttach.id }, "Fallo actualizando ciclo del payment antes de asociarlo");
    });
  }

  const targetWindowStart = cycleToAttach
    ? new Date(new Date(cycleToAttach.periodStartAt).getTime() - toleranceMs)
    : activeCycle
      ? new Date(new Date(activeCycle.periodStartAt).getTime() - toleranceMs)
      : new Date(paymentAt.getTime() - toleranceMs);
  const targetWindowEnd = cycleToAttach
    ? new Date(new Date(cycleToAttach.periodEndAt).getTime() + toleranceMs)
    : activeCycle
      ? new Date(new Date(activeCycle.periodEndAt).getTime() + toleranceMs)
      : new Date(paymentAt.getTime() + toleranceMs);
  if (paymentAt < targetWindowStart || paymentAt > targetWindowEnd) {
    return {
      ok: false as const,
      error: "out_of_cycle" as const,
      details: {
        paidAt: paymentAt,
        periodStart: cycleToAttach ? cycleToAttach.periodStartAt : (activeCycle?.periodStartAt || null),
        periodEnd: cycleToAttach ? cycleToAttach.periodEndAt : (activeCycle?.periodEndAt || null)
      }
    };
  }
  const actor = args.actorEmail ? String(args.actorEmail) : "system";
  const finalCycleNumber = cycleToAttach?.cycleNumber ?? payment.cycleNumber ?? activeCycle?.cycleNumber ?? 1;
  const finalKey = await cycleKeyFor(finalCycleNumber);
  await prisma.$transaction(async (tx) => {
    const existingCycle = await tx.subscriptionBillingCycle.findFirst({
      where: { paymentId: payment.id }
    });
    if (existingCycle && cycleToAttach && existingCycle.id !== cycleToAttach.id) {
      await tx.subscriptionBillingCycle.update({
        where: { id: existingCycle.id },
        data: {
          status: "PENDING",
          paidAt: null,
          paymentId: null,
          paidOnTime: null,
          daysEarly: null,
          daysLate: null,
          origin: null,
          associationReason: null,
          associatedBy: null
        }
      });
    }

    const cycleNumber = cycleToAttach?.cycleNumber ?? payment.cycleNumber ?? activeCycle?.cycleNumber ?? 1;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        cycleNumber,
        ...(finalKey ? { subscriptionCycleKey: finalKey } : {}),
        associationReason: "MANUAL_RECONCILE" as any,
        associatedBy: actor
      }
    });

    if (cycleToAttach) {
      const dueAt = cycleToAttach.dueAt || cycleToAttach.periodEndAt;
      const graceDays = Number.isFinite(subscription.graceDays as any) ? Math.max(0, Number(subscription.graceDays || 0)) : 0;
      const dueWithGrace = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
      const msDiff = paymentAt.getTime() - dueWithGrace.getTime();
      const daysLate = msDiff > 0 ? Math.ceil(msDiff / (24 * 60 * 60 * 1000)) : 0;
      const daysEarly = msDiff < 0 ? Math.ceil(Math.abs(msDiff) / (24 * 60 * 60 * 1000)) : 0;
      const paidOnTime = msDiff <= 0;

      await tx.subscriptionBillingCycle.update({
        where: { id: cycleToAttach.id },
        data: {
          paymentId: payment.id,
          paidAt: paymentAt,
          status: "PAID",
          paidOnTime,
          daysEarly,
          daysLate,
          origin: payment.origin,
          associationReason: "MANUAL_RECONCILE",
          associatedBy: actor
        }
      });
    }
  });

  await systemLog(
    LogLevel.INFO,
    "logs.payments",
    "Pago asociado manualmente a suscripción",
    {
      paymentId: payment.id,
      subscriptionId: subscription.id,
      tenantId: payment.tenantId,
      actor: args.actorEmail || "system"
    },
    args.actorEmail || "Sistema"
  ).catch((err: any) => {
    logger.warn({ err, paymentId: payment.id, subscriptionId: subscription.id }, "Fallo escribiendo systemLog de asociacion manual");
  });

  return { ok: true as const, updated: true as const };
}
