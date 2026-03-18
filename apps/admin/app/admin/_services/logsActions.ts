import "server-only";

import { prisma } from "@suscripciones/database";
import { LogLevel, PaymentStatus, RetryJobStatus, RetryJobType, WebhookProcessStatus, WebhookProvider } from "@prisma/client";
import { classifyReference } from "@suscripciones/core/webhooks/wompi/classifyReference";
import { reconcileWompiByReference, reconcileWompiTransaction } from "@suscripciones/core/services/wompiReconcile";
import { systemLog } from "@suscripciones/core/services/systemLog";

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
  ).catch(() => {});

  if (!payment) {
    if (wompiTransactionId) {
      await systemLog(
        LogLevel.WARN,
        "logs.payments",
        "Reconciliar pago sin registro previo de Payment",
        { wompiTransactionId, ok: reconcile.ok, reason: (reconcile as any)?.reason || null },
        "Sistema"
      ).catch(() => {});
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

  return { ok: reconcile.ok, reconcile, payment: refreshed };
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
      wompiTransactionId: { not: null },
      createdAt: { lte: before },
      ...(tenantId ? { tenantId } : {})
    },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, tenantId: true, wompiTransactionId: true }
  });

  let reconciled = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ paymentId: string; tx: string; reason: string }> = [];

  for (const payment of pending) {
    const tx = String(payment.wompiTransactionId || "").trim();
    if (!tx) {
      skipped += 1;
      continue;
    }
    try {
      const out = await reconcileWompiTransaction({
        wompiTransactionId: tx,
        tenantId: payment.tenantId,
        checksumPrefix: "manual-pending-reconcile"
      });
      if (out?.ok) reconciled += 1;
      else {
        skipped += 1;
        if (out?.reason && out.reason !== "status_not_final") {
          errors.push({ paymentId: payment.id, tx, reason: String(out.reason) });
        }
      }
    } catch (err: any) {
      failed += 1;
      errors.push({ paymentId: payment.id, tx, reason: String(err?.message || "reconcile_failed") });
    }
  }

  await systemLog(
    LogLevel.INFO,
    "logs.payments",
    "Reconciliar pendientes ejecutado",
    { minutes, take, scanned: pending.length, reconciled, skipped, failed },
    "Sistema"
  ).catch(() => {});

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
          data: { type: RetryJobType.FORWARD_WOMPI_TO_SHOPIFY, payload: { webhookEventId: event.id } }
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
  ).catch(() => {});

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
