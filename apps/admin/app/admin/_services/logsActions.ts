import "server-only";

import { prisma } from "@suscripciones/database";
import { LogLevel, PaymentStatus, RetryJobStatus, RetryJobType, WebhookProcessStatus, WebhookProvider } from "@prisma/client";
import { classifyReference } from "@suscripciones/core/webhooks/wompi/classifyReference";
import { reconcileWompiByReference, reconcileWompiTransaction } from "@suscripciones/core/services/wompiReconcile";
import { systemLog } from "@suscripciones/core/services/systemLog";
import { attachPaymentToCycle, buildSubscriptionSeed, ensureBillingCyclesForSubscriptions, findBestBillingCycleForPayment, resolveConfiguredCollectionCycle, resolveSubscriptionBillingState } from "@suscripciones/core/services/billingCycles";
import { getSubscriptionPricingTotal } from "@suscripciones/core/lib/metadataSchemas";
import { logger } from "@suscripciones/core/lib/logger";

function normalizePhoneDigits(value: unknown): string {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("57") && digits.length > 10) return digits.slice(-10);
  return digits;
}

function phonesMatch(a: unknown, b: unknown): boolean {
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

function parseDateStart(value?: string | null) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(value?: string | null) {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function estimateCyclesBack(args: {
  startAt: Date;
  intervalUnit: string;
  intervalCount: number;
  paymentAt: Date;
}) {
  const start = args.startAt;
  const paymentAt = args.paymentAt;
  if (paymentAt.getTime() >= start.getTime()) return 12;
  const count = Math.max(1, Math.trunc(args.intervalCount || 1));
  const msDiff = start.getTime() - paymentAt.getTime();
  const daysDiff = Math.ceil(msDiff / (24 * 60 * 60 * 1000));
  if (args.intervalUnit === "MONTH") {
    const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
    const payMonth = paymentAt.getUTCFullYear() * 12 + paymentAt.getUTCMonth();
    const monthsDiff = Math.max(0, startMonth - payMonth);
    const cycles = Math.ceil(monthsDiff / count) + 2;
    return Math.max(12, cycles);
  }
  if (args.intervalUnit === "WEEK") {
    const cycles = Math.ceil(daysDiff / (count * 7)) + 2;
    return Math.max(12, cycles);
  }
  const cycles = Math.ceil(daysDiff / count) + 2;
  return Math.max(12, cycles);
}

export async function retryJobById(id: string) {
  const jobId = String(id || "").trim();
  if (!jobId) return { ok: false as const, error: "invalid_id" as const };
  const job = await prisma.retryJob.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false as const, error: "not_found" as const };
  await prisma.retryJob.update({
    where: { id: jobId },
    data: { status: RetryJobStatus.PENDING, runAt: new Date(), lockedAt: null, lockedBy: null }
  });
  return { ok: true as const };
}

export async function retryWebhookById(id: string) {
  const eventId = String(id || "").trim();
  if (!eventId) return { ok: false as const, error: "invalid_id" as const };
  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false as const, error: "not_found" as const };

  const pending = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.PROCESS_WOMPI_EVENT,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
      payload: { path: ["webhookEventId"], equals: eventId } as any
    }
  });
  if (pending) return { ok: true as const, retried: 0, reason: "already_pending" as const };

  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { processStatus: WebhookProcessStatus.RECEIVED, errorMessage: null, processedAt: null }
  });
  await prisma.retryJob.create({
    data: { type: RetryJobType.PROCESS_WOMPI_EVENT, payload: { webhookEventId: eventId } }
  });
  return { ok: true as const, retried: 1 };
}

export async function retryFailedWebhooks() {
  const failed = await prisma.webhookEvent.findMany({
    where: { provider: WebhookProvider.WOMPI, processStatus: WebhookProcessStatus.FAILED },
    orderBy: { receivedAt: "desc" },
    take: 200
  });
  if (!failed.length) return { ok: true as const, retried: 0 };

  const pendingJobs = await prisma.retryJob.findMany({
    where: {
      type: RetryJobType.PROCESS_WOMPI_EVENT,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] }
    }
  });
  const pendingIds = new Set(
    pendingJobs.map((j: any) => (j.payload as any)?.webhookEventId).filter((id: any) => typeof id === "string" && id.length)
  );

  const toRetry = failed.filter((event) => !pendingIds.has(event.id));
  if (!toRetry.length) return { ok: true as const, retried: 0, skipped: failed.length };

  await prisma.webhookEvent.updateMany({
    where: { id: { in: toRetry.map((e) => e.id) } },
    data: { processStatus: WebhookProcessStatus.RECEIVED, errorMessage: null, processedAt: null }
  });

  await prisma.retryJob.createMany({
    data: toRetry.map((event) => ({
      type: RetryJobType.PROCESS_WOMPI_EVENT,
      payload: { webhookEventId: event.id }
    }))
  });

  return { ok: true as const, retried: toRetry.length, skipped: failed.length - toRetry.length };
}

export async function reconcilePayment(args: {
  paymentId?: string;
  reference?: string;
  wompiPaymentLinkId?: string;
  wompiTransactionId?: string;
  tenantId?: string;
  amountInCents?: number;
  currency?: string;
  actorEmail?: string;
}) {
  const paymentId = String(args.paymentId || "").trim();
  const reference = String(args.reference || "").trim();
  const wompiPaymentLinkId = String(args.wompiPaymentLinkId || "").trim();
  let wompiTransactionId = String(args.wompiTransactionId || "").trim();
  const tenantIdFromBody = String(args.tenantId || "").trim();
  const amountInCentsRaw = Number(args.amountInCents ?? 0);
  const amountInCents = Number.isFinite(amountInCentsRaw) && amountInCentsRaw > 0 ? Math.trunc(amountInCentsRaw) : undefined;
  const currency = String(args.currency || "").trim().toUpperCase();

  let payment =
    (paymentId ? await prisma.payment.findUnique({ where: { id: paymentId } }) : null) ||
    (reference ? await prisma.payment.findFirst({ where: { reference } }) : null) ||
    (wompiPaymentLinkId ? await prisma.payment.findFirst({ where: { wompiPaymentLinkId } }) : null) ||
    (wompiTransactionId ? await prisma.payment.findFirst({ where: { wompiTransactionId } }) : null);
  if (!wompiTransactionId && payment?.wompiTransactionId) {
    wompiTransactionId = String(payment.wompiTransactionId || "").trim();
  }
  const resolvedTenantId = tenantIdFromBody || String(payment?.tenantId || "").trim() || undefined;

  let reconcile: any;
  if (wompiTransactionId) {
    if (payment && payment.wompiTransactionId !== wompiTransactionId) {
      payment = await prisma.payment.update({
        where: { id: payment.id },
        data: { wompiTransactionId }
      });
    }
    reconcile = await reconcileWompiTransaction({
      wompiTransactionId,
      tenantId: resolvedTenantId || undefined,
      checksumPrefix: payment ? "manual-reconcile" : "manual-reconcile-no-payment"
    }).catch((err: any) => ({
      ok: false as const,
      reason: "reconcile_failed" as const,
      message: String(err?.message || err || "reconcile_failed")
    }));
  } else {
    const referenceCandidate = reference || String(payment?.reference || "").trim();
    const paymentLinkCandidate = wompiPaymentLinkId || String(payment?.wompiPaymentLinkId || "").trim();
    if (!referenceCandidate) return { ok: false as const, error: "missing_reconcile_identifiers" as const };
    reconcile = await reconcileWompiByReference({
      reference: referenceCandidate,
      tenantId: resolvedTenantId || undefined,
      paymentLinkId: paymentLinkCandidate || undefined,
      amountInCents: amountInCents ?? (payment ? Number(payment.amountInCents || 0) : undefined),
      currency: currency || (payment ? String(payment.currency || "").trim().toUpperCase() : undefined),
      checksumPrefix: payment ? "manual-reconcile-ref" : "manual-reconcile-ref-no-payment"
    }).catch((err: any) => ({
      ok: false as const,
      reason: "reconcile_failed" as const,
      message: String(err?.message || err || "reconcile_failed")
    }));
  }

  await systemLog(
    LogLevel.INFO,
    "logs.payments",
    "Reconciliar pago ejecutado",
    {
      paymentId: payment?.id || null,
      wompiTransactionId: wompiTransactionId || null,
      reference: reference || payment?.reference || null,
      ok: reconcile.ok,
      reason: (reconcile as any)?.reason || null
    },
    "Sistema"
  ).catch((err: any) => {
    logger.warn({ err, paymentId: payment?.id || null, wompiTransactionId, reference }, "Fallo escribiendo systemLog de reconcile manual");
  });

  if (!payment) {
    if (wompiTransactionId) {
      await systemLog(
        LogLevel.WARN,
        "logs.payments",
        "Reconciliar pago sin registro previo de Payment",
        { wompiTransactionId, ok: reconcile.ok, reason: (reconcile as any)?.reason || null },
        "Sistema"
      ).catch((err: any) => {
        logger.warn({ err, wompiTransactionId }, "Fallo escribiendo systemLog de reconcile sin payment");
      });
    }
    return { ok: reconcile.ok, reconcile, payment: null };
  }

  const refreshed = await prisma.payment.findUnique({
    where: { id: payment.id },
    select: {
      id: true,
      status: true,
      paidAt: true,
      failedAt: true,
      wompiTransactionId: true,
      wompiPaymentLinkId: true,
      reference: true
    }
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      associationReason: "MANUAL_RECONCILE" as any,
      associatedBy: args.actorEmail ? String(args.actorEmail) : "system"
    }
  }).catch((err: any) => {
    logger.warn({ err, paymentId: payment.id }, "Fallo marcando associationReason tras reconcile manual");
  });

  return { ok: reconcile.ok, reconcile, payment: refreshed };
}

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
    buildSubscriptionSeed({
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
    cycleToAttach = await prisma.subscriptionBillingCycle.findFirst({
      where: {
        subscriptionId: subscription.id,
        paymentId: null,
        status: { not: "PAID" },
        dueAt: { lte: now }
      },
      orderBy: { dueAt: "asc" }
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

  if (cycleToAttach) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        cycleNumber: cycleToAttach.cycleNumber,
        subscriptionCycleKey: `${subscription.id}:${cycleToAttach.cycleNumber}`
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
        subscriptionCycleKey: cycleNumber ? `${subscription.id}:${cycleNumber}` : payment.subscriptionCycleKey,
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

export async function autoAssociateUnlinkedPayments(args: {
  tenantId?: string;
  from?: string;
  to?: string;
  take?: number;
  actorEmail?: string;
  minScore?: number;
}) {
  const tenantId = String(args.tenantId || "").trim();
  const from = parseDateStart(args.from || "");
  const to = parseDateEnd(args.to || "");
  const takeRaw = Number(args.take ?? 300);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 50), 2000) : 300;
  const minScore = Number.isFinite(args.minScore) ? Math.max(0, Math.trunc(args.minScore!)) : 70;

  const dateFilter =
    from && to
      ? {
          OR: [
            { paidAt: { gte: from, lte: to } },
            { paidAt: null, createdAt: { gte: from, lte: to } }
          ]
        }
      : null;

  const payments = await prisma.payment.findMany({
    where: {
      subscriptionId: null,
      status: PaymentStatus.APPROVED,
      amountInCents: { gt: 0 },
      ...(tenantId ? { tenantId } : {}),
      ...(dateFilter ? { AND: [dateFilter] } : {})
    },
    include: {
      customer: true
    },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    take
  });

  let associated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ paymentId: string; reason: string }> = [];

  for (const payment of payments) {
    try {
      if (payment.subscriptionId) {
        skipped += 1;
        continue;
      }
      const paymentAt = payment.paidAt || payment.createdAt;
      const amountInCents = Number(payment.amountInCents || 0);
      const currency = String(payment.currency || "").trim().toUpperCase();
      if (!amountInCents) {
        skipped += 1;
        continue;
      }

      const reference = String(payment.reference || "").trim();
      const refClass = reference ? classifyReference(reference) : null;

      const resolveMatchCycle = async (
        subscriptionId: string,
        cycleNumber?: number | null,
        paymentTiming?: string | null
      ) => {
        const cycles = await prisma.subscriptionBillingCycle.findMany({
          where: {
            subscriptionId,
            paymentId: null,
            status: { not: "PAID" }
          },
          orderBy: [{ dueAt: "asc" }, { cycleNumber: "asc" }]
        });
        return findBestBillingCycleForPayment({
          cycles,
          paymentAt,
          cycleNumberHint:
            cycleNumber ??
            resolveConfiguredCollectionCycle({
              cycles,
              asOf: paymentAt,
              paymentTiming: String(paymentTiming || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO"
            })?.cycleNumber ??
            null,
          toleranceDays: 7
        });
      };

      if (refClass && refClass.kind === "subscription" && refClass.subscriptionId) {
        const subscription = await prisma.subscription.findUnique({
          where: { id: refClass.subscriptionId },
          include: { plan: true, customer: true }
        });
        if (!subscription) {
          skipped += 1;
          continue;
        }
        if (!["ACTIVE", "PAST_DUE"].includes(String(subscription.status || "").toUpperCase())) {
          skipped += 1;
          continue;
        }
        const planAmount = getSubscriptionPricingTotal(subscription.metadata, subscription.plan?.priceInCents || 0);
        const planCurrency = String(subscription.plan?.currency || "").trim().toUpperCase();
        if (planAmount !== amountInCents || (currency && planCurrency && currency !== planCurrency)) {
          skipped += 1;
          continue;
        }

        const cyclesBack = estimateCyclesBack({
          startAt: subscription.startAt,
          intervalUnit: subscription.plan.intervalUnit,
          intervalCount: subscription.plan.intervalCount,
          paymentAt
        });
        await ensureBillingCyclesForSubscriptions(
          [
            {
              id: subscription.id,
              startAt: subscription.startAt,
              cycleStartDay: subscription.cycleStartDay,
              paymentDay: subscription.paymentDay,
              paymentTiming: (subscription.paymentTiming as any) || "EN_CURSO",
              graceDays: subscription.graceDays,
              plan: { intervalUnit: subscription.plan.intervalUnit, intervalCount: subscription.plan.intervalCount }
            }
          ],
          cyclesBack,
          2
        ).catch((err: any) => {
          logger.warn({ err, paymentId: payment.id, subscriptionId: subscription.id }, "Fallo asegurando ciclos para autoasociacion por referencia");
        });

        const cycle = await resolveMatchCycle(subscription.id, refClass.cycle ?? null, subscription.paymentTiming as any);
        if (!cycle) {
          skipped += 1;
          continue;
        }

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            associationReason: "SUB_REF" as any,
            associatedBy: args.actorEmail ? String(args.actorEmail) : "system",
            matchScore: 100,
            matchCriteria: {
              method: "reference",
              amountInCents,
              currency: currency || null,
              cycleNumber: cycle.cycleNumber
            } as any,
            cycleNumber: cycle.cycleNumber,
            subscriptionCycleKey: `${subscription.id}:${cycle.cycleNumber}`
          }
        });

        await attachPaymentToCycle({
          paymentId: payment.id,
          subscriptionId: subscription.id,
          cycleId: cycle.id,
          paymentAt,
          origin: payment.origin,
          associationReason: "SUB_REF" as any,
          associatedBy: args.actorEmail ? String(args.actorEmail) : "system"
        }).catch((err: any) => {
          logger.warn({ err, paymentId: payment.id, subscriptionId: subscription.id, cycleId: cycle.id }, "Fallo asociando pago a ciclo por referencia");
        });

        associated += 1;
        continue;
      }

      const customerIds = new Set<string>();
      let identitySource: "email" | "phone" | "name" | "email_phone" | null = null;
      const email = String(payment.customer?.email || "").trim().toLowerCase();
      const phone = String(payment.customer?.phone || "").trim();
      const name = String(payment.customer?.name || "").trim();

      if (email) {
        const byEmail = await prisma.customer.findMany({
          where: {
            email,
            ...(tenantId
              ? {
                  OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }]
                }
              : {})
          },
          select: { id: true }
        });
        if (byEmail.length) identitySource = "email";
        byEmail.forEach((c) => customerIds.add(c.id));
      }

      if (phone) {
        const byPhone = await prisma.customer.findMany({
          where: {
            phone: { not: null },
            ...(tenantId
              ? {
                  OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }]
                }
              : {})
          },
          select: { id: true, phone: true },
          take: 500
        });
        const matched = byPhone.filter((c) => phonesMatch(c.phone, phone));
        if (matched.length) identitySource = identitySource ? "email_phone" : "phone";
        matched.forEach((c) => customerIds.add(c.id));
      }

      if (!customerIds.size) {
        const nameNorm = normalizeNameForMatch(name);
        if (nameNorm.length >= 4) {
          const byName = await prisma.customer.findMany({
            where: {
              name: { contains: name, mode: "insensitive" },
              ...(tenantId
                ? {
                    OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }]
                  }
                : {})
            },
            select: { id: true, name: true },
            orderBy: { updatedAt: "desc" },
            take: 100
          });
          const matched = byName.filter((c) => normalizeNameForMatch(c.name) === nameNorm);
          if (matched.length) identitySource = "name";
          matched.forEach((c) => customerIds.add(c.id));
        }
      }

      if (!customerIds.size || !identitySource) {
        skipped += 1;
        continue;
      }

      const candidates = await prisma.subscription.findMany({
        where: {
          customerId: { in: Array.from(customerIds) },
          ...(tenantId
            ? {
                OR: [{ tenantId }, { tenantLinks: { some: { tenantId } } }]
              }
            : {})
        },
        include: { plan: true }
      });

      const amountMatches = candidates.filter((sub) => {
        const planAmount = getSubscriptionPricingTotal(sub.metadata, sub.plan?.priceInCents || 0);
        const planCurrency = String(sub.plan?.currency || "").trim().toUpperCase();
        if (planAmount !== amountInCents) return false;
        if (currency && planCurrency && currency !== planCurrency) return false;
        return true;
      });

      if (!amountMatches.length) {
        skipped += 1;
        continue;
      }

      const withActive = amountMatches.filter((sub) =>
        ["ACTIVE", "PAST_DUE"].includes(String(sub.status || "").toUpperCase())
      );
      const usableSubs = withActive.length ? withActive : amountMatches;

      let selected = usableSubs[0];
      let selectedCycle: any = null;

      for (const sub of usableSubs) {
        const cyclesBack = estimateCyclesBack({
          startAt: sub.startAt,
          intervalUnit: sub.plan.intervalUnit,
          intervalCount: sub.plan.intervalCount,
          paymentAt
        });
        await ensureBillingCyclesForSubscriptions(
          [
            {
              id: sub.id,
              startAt: sub.startAt,
              cycleStartDay: sub.cycleStartDay,
              paymentDay: sub.paymentDay,
              paymentTiming: (sub.paymentTiming as any) || "EN_CURSO",
              graceDays: sub.graceDays,
              plan: { intervalUnit: sub.plan.intervalUnit, intervalCount: sub.plan.intervalCount }
            }
          ],
          cyclesBack,
          2
        ).catch((err: any) => {
          logger.warn({ err, paymentId: payment.id, subscriptionId: sub.id }, "Fallo asegurando ciclos para autoasociacion por identidad");
        });
      }

      if (usableSubs.length > 1) {
        let oldest: { sub: any; cycle: any } | null = null;
        for (const sub of usableSubs) {
          const cycle = await prisma.subscriptionBillingCycle.findFirst({
            where: {
              subscriptionId: sub.id,
              paymentId: null,
              status: { not: "PAID" }
            },
            orderBy: [{ dueAt: "asc" }, { periodStartAt: "asc" }, { cycleNumber: "asc" }]
          });
          if (!cycle) continue;
          if (!oldest) {
            oldest = { sub, cycle };
          } else if (cycle.dueAt.getTime() < oldest.cycle.dueAt.getTime()) {
            oldest = { sub, cycle };
          }
        }
        if (oldest) {
          selected = oldest.sub;
        }
      }

      selectedCycle = await resolveMatchCycle(selected.id, null);
      if (!selectedCycle) {
        skipped += 1;
        continue;
      }

      const score = identitySource === "name" ? 70 : 80;
      if (score < minScore) {
        skipped += 1;
        continue;
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          subscriptionId: selected.id,
          customerId: selected.customerId,
          associationReason: "IDENTITY_MATCH" as any,
          associatedBy: args.actorEmail ? String(args.actorEmail) : "system",
          matchScore: score,
          matchCriteria: {
            method: "identity",
            source: identitySource,
            amountInCents,
            currency: currency || null,
            cycleNumber: selectedCycle.cycleNumber,
            tieBreak: usableSubs.length > 1 ? "oldest_unpaid_cycle" : undefined
          } as any,
          cycleNumber: selectedCycle.cycleNumber,
          subscriptionCycleKey: `${selected.id}:${selectedCycle.cycleNumber}`
        }
      });

      await attachPaymentToCycle({
        paymentId: payment.id,
        subscriptionId: selected.id,
        cycleId: selectedCycle.id,
        paymentAt,
        origin: payment.origin,
        associationReason: "IDENTITY_MATCH" as any,
        associatedBy: args.actorEmail ? String(args.actorEmail) : "system"
      }).catch((err: any) => {
        logger.warn({ err, paymentId: payment.id, subscriptionId: selected.id, cycleId: selectedCycle.id }, "Fallo asociando pago a ciclo por identidad");
      });

      associated += 1;
    } catch (err: any) {
      failed += 1;
      errors.push({ paymentId: payment.id, reason: String(err?.message || "unknown_error") });
    }
  }

  return { ok: true as const, associated, skipped, failed, errors: errors.slice(0, 50) };
}

export async function reconcilePendingPayments(args: { minutes?: number; take?: number; tenantId?: string }) {
  const minutesRaw = Number(args.minutes ?? 30);
  const minutes = Number.isFinite(minutesRaw) ? Math.min(Math.max(Math.trunc(minutesRaw), 1), 24 * 60) : 30;
  const takeRaw = Number(args.take ?? 300);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 1000) : 200;
  const tenantId = String(args.tenantId || "").trim();
  const before = new Date(Date.now() - minutes * 60 * 1000);

  const pending = await prisma.payment.findMany({
    where: {
      status: { in: [PaymentStatus.PENDING, PaymentStatus.ERROR] },
      createdAt: { lte: before },
      ...(tenantId ? { tenantId } : {})
    },
    orderBy: { createdAt: "asc" },
    take,
    select: {
      id: true,
      tenantId: true,
      wompiTransactionId: true,
      wompiPaymentLinkId: true,
      reference: true,
      amountInCents: true,
      currency: true
    }
  });

  let reconciled = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ paymentId: string; tx: string; reason: string }> = [];

  for (const payment of pending) {
    try {
      const tx = String(payment.wompiTransactionId || "").trim();
      const reference = String(payment.reference || "").trim();
      const paymentLinkId = String(payment.wompiPaymentLinkId || "").trim();
      let out: any = null;
      if (tx) {
        out = await reconcileWompiTransaction({
          wompiTransactionId: tx,
          tenantId: payment.tenantId,
          checksumPrefix: "manual-pending-reconcile"
        });
      } else if (reference || paymentLinkId) {
        out = await reconcileWompiByReference({
          reference: reference || paymentLinkId,
          tenantId: payment.tenantId,
          paymentLinkId: paymentLinkId || undefined,
          amountInCents: payment.amountInCents || undefined,
          currency: payment.currency || undefined,
          checksumPrefix: "manual-pending-reconcile-ref"
        });
      } else {
        skipped += 1;
        continue;
      }
      if (out?.ok) {
        reconciled += 1;
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            associationReason: "MANUAL_RECONCILE" as any,
            associatedBy: "system"
          }
        }).catch((err: any) => {
          logger.warn({ err, paymentId: payment.id }, "Fallo marcando associationReason tras reconcile de pendientes");
        });
      }
      else {
        skipped += 1;
        if (out?.reason && out.reason !== "status_not_final") {
          errors.push({ paymentId: payment.id, tx: tx || paymentLinkId || reference, reason: String(out.reason) });
        }
      }
    } catch (err: any) {
      failed += 1;
      const tx = String(payment.wompiTransactionId || payment.wompiPaymentLinkId || payment.reference || "").trim();
      errors.push({ paymentId: payment.id, tx, reason: String(err?.message || "reconcile_failed") });
    }
  }

  await systemLog(
    LogLevel.INFO,
    "logs.payments",
    "Reconciliar pendientes ejecutado",
    { minutes, take, scanned: pending.length, reconciled, skipped, failed },
    "Sistema"
  ).catch((err: any) => {
    logger.warn({ err, minutes, take, scanned: pending.length }, "Fallo escribiendo systemLog de reconcile de pendientes");
  });

  return {
    ok: true,
    minutes,
    take,
    scanned: pending.length,
    reconciled,
    skipped,
    failed,
    errors: errors.slice(0, 50)
  };
}

export async function recollectPayments(args: { days?: number; take?: number }) {
  const daysRaw = Number(args.days ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 30) : 7;
  const takeRaw = Number(args.take ?? 800);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 50), 2000) : 800;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.webhookEvent.findMany({
    where: { provider: "WOMPI", receivedAt: { gte: since } },
    orderBy: { receivedAt: "desc" },
    take
  });

  let reconciledNow = 0;
  let queuedProcess = 0;
  let queuedForward = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ webhookEventId: string; tx?: string; reason: string }> = [];

  for (const event of events) {
    const payload: any = event.payload;
    const tx = payload?.data?.transaction;
    const reference = String(tx?.reference || "").trim();
    const txId = String(tx?.id || "").trim();
    const paymentLinkId = String(tx?.payment_link_id || tx?.paymentLinkId || "").trim();

    const classification = classifyReference(reference);
    const isShopify = classification.kind === "shopify";

    if (isShopify) {
      const exists = await prisma.retryJob.findFirst({
        where: {
          type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
          payload: { path: ["webhookEventId"], equals: event.id } as any
        }
      });
      if (!exists) {
        await prisma.retryJob.create({
          data: { type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY, payload: { webhookEventId: event.id }, maxAttempts: 3 }
        });
        queuedForward += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const txStatus = String(tx?.status || "").trim().toUpperCase();
    const isFinalTx = ["APPROVED", "DECLINED", "VOIDED", "ERROR"].includes(txStatus);

    let matchedPayment: any = null;
    if (txId) {
      matchedPayment = await prisma.payment.findUnique({ where: { wompiTransactionId: txId } });
    }
    if (!matchedPayment && paymentLinkId) {
      matchedPayment = await prisma.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } });
    }
    if (!matchedPayment && reference) {
      matchedPayment = await prisma.payment.findFirst({
        where: {
          reference,
          ...(event.tenantId ? { tenantId: event.tenantId } : {})
        },
        orderBy: { createdAt: "desc" }
      });
    }

    const paymentIsFinal =
      matchedPayment && ["APPROVED", "DECLINED", "VOIDED", "ERROR"].includes(String(matchedPayment.status || "").toUpperCase());
    const paymentMatchesTxFinalState =
      Boolean(matchedPayment) && (!isFinalTx || String(matchedPayment.status || "").toUpperCase() === txStatus);

    if (paymentIsFinal && paymentMatchesTxFinalState) {
      skipped += 1;
      continue;
    }

    if (txId) {
      try {
        const out = await reconcileWompiTransaction({
          wompiTransactionId: txId,
          tenantId: event.tenantId || undefined,
          checksumPrefix: "manual-recollect"
        });
        if (out?.ok) {
          reconciledNow += 1;
          continue;
        }
        skipped += 1;
        if (out?.reason && out.reason !== "status_not_final") {
          errors.push({ webhookEventId: event.id, tx: txId, reason: String(out.reason) });
        }
        continue;
      } catch (err: any) {
        failed += 1;
        errors.push({ webhookEventId: event.id, tx: txId, reason: String(err?.message || "reconcile_failed") });
        continue;
      }
    }

    const exists = await prisma.retryJob.findFirst({
      where: {
        type: RetryJobType.PROCESS_WOMPI_EVENT,
        payload: { path: ["webhookEventId"], equals: event.id } as any
      }
    });
    if (!exists) {
      await prisma.retryJob.create({
        data: { type: RetryJobType.PROCESS_WOMPI_EVENT, payload: { webhookEventId: event.id } }
      });
      queuedProcess += 1;
    } else {
      skipped += 1;
    }
  }

  await systemLog(
    LogLevel.INFO,
    "logs.payments",
    "Recolectar pagos ejecutado",
    { days, take, reconciledNow, queuedProcess, queuedForward, skipped, failed },
    "Sistema"
  ).catch((err: any) => {
    logger.warn({ err, days, take, reconciledNow, queuedProcess, queuedForward, skipped, failed }, "Fallo escribiendo systemLog de recolectar pagos");
  });

  return {
    ok: true,
    reconciledNow,
    queuedProcess,
    queuedForward,
    skipped,
    failed,
    errors: errors.slice(0, 50),
    days,
    take
  };
}

type ShopifyForwardError =
  | "missing_payment_id"
  | "payment_not_found"
  | "not_shopify_payment"
  | "webhook_event_not_found";

type ShopifyForwardResult =
  | { ok: false; error: ShopifyForwardError }
  | { ok: true; queued: boolean; webhookEventId: string };

export async function enqueueShopifyForwardForPayment(args: { paymentId: string }): Promise<ShopifyForwardResult> {
  const paymentId = String(args.paymentId || "").trim();
  if (!paymentId) return { ok: false as const, error: "missing_payment_id" as const };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      tenantId: true,
      reference: true,
      wompiTransactionId: true,
      wompiPaymentLinkId: true,
      providerResponse: true
    }
  });
  if (!payment) return { ok: false as const, error: "payment_not_found" as const };

  const reference = String(payment.reference || "").trim();
  const classification = classifyReference(reference);
  const providerResponse = payment.providerResponse && typeof payment.providerResponse === "object" ? (payment.providerResponse as any) : null;
  const sourceRaw = String(
    providerResponse?.reconciliation?.source ||
      providerResponse?.origin ||
      providerResponse?.provider ||
      providerResponse?.source ||
      ""
  ).toLowerCase();
  const isShopify = classification.kind === "shopify" || sourceRaw.includes("shopify");
  if (!isShopify) return { ok: false as const, error: "not_shopify_payment" as const };

  const events = await prisma.webhookEvent.findMany({
    where: { provider: "WOMPI", ...(payment.tenantId ? { tenantId: payment.tenantId } : {}) },
    orderBy: { receivedAt: "desc" },
    take: 500
  });

  const txId = String(payment.wompiTransactionId || "").trim();
  const linkId = String(payment.wompiPaymentLinkId || "").trim();
  const match = events.find((event) => {
    const payload: any = event.payload as any;
    const tx = payload?.data?.transaction || payload?.data?.tx || payload?.transaction || null;
    const evRef = String(tx?.reference || "").trim();
    const evTx = String(tx?.id || "").trim();
    const evLink = String(tx?.payment_link_id || tx?.paymentLinkId || "").trim();
    return (txId && evTx === txId) || (linkId && evLink === linkId) || (reference && evRef === reference);
  });

  if (!match) return { ok: false as const, error: "webhook_event_not_found" as const };

  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY,
      payload: { path: ["webhookEventId"], equals: match.id } as any
    }
  });
  if (existing) return { ok: true as const, queued: false, webhookEventId: match.id };

  await prisma.retryJob.create({
    data: { type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY, payload: { webhookEventId: match.id }, maxAttempts: 3 }
  });
  return { ok: true as const, queued: true, webhookEventId: match.id };
}
