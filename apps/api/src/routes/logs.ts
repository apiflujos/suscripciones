import express from "express";
import { prisma } from "../db/prisma";
import { PaymentStatus, Prisma, RetryJobStatus, RetryJobType, WebhookProvider, WebhookProcessStatus } from "@prisma/client";
import { classifyReference } from "../webhooks/wompi/classifyReference";
import { systemLog } from "../services/systemLog";
import { LogLevel } from "@prisma/client";
import { getChatwootConfig } from "../services/runtimeConfig";
import { ChatwootClient } from "../providers/chatwoot/client";
import { reconcileWompiTransaction } from "../services/wompiReconcile";

export const logsRouter = express.Router();

const DEFAULT_LOG_WINDOW_DAYS = 30;

function parseDate(raw: string, opts?: { end?: boolean }) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const end = Boolean(opts?.end);
  const isDateOnly = raw.length === 10 && /\d{4}-\d{2}-\d{2}/.test(raw);
  if (end && isDateOnly) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

function defaultFromDate() {
  return new Date(Date.now() - DEFAULT_LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pickProviderFailureMessage(providerResponse: unknown): string | null {
  if (!providerResponse || typeof providerResponse !== "object") return null;
  const root = providerResponse as Record<string, any>;
  const candidates = [
    root?.status_message,
    root?.statusMessage,
    root?.reason,
    root?.error,
    root?.error_message
  ];
  for (const candidate of candidates) {
    const text = stringOrNull(candidate);
    if (text) return text;
  }
  const errorObj = root?.error;
  if (errorObj && typeof errorObj === "object") {
    const maybeMessage =
      stringOrNull((errorObj as any).message) ||
      stringOrNull((errorObj as any).reason) ||
      stringOrNull((errorObj as any).type);
    if (maybeMessage) return maybeMessage;
    const messages = (errorObj as any).messages;
    if (messages && typeof messages === "object") {
      for (const value of Object.values(messages as Record<string, any>)) {
        if (Array.isArray(value)) {
          const first = value.map((v) => stringOrNull(v)).find(Boolean);
          if (first) return first;
        }
        const text = stringOrNull(value);
        if (text) return text;
      }
    }
  }
  const webhookTx = root?.webhook?.data?.transaction;
  if (webhookTx && typeof webhookTx === "object") {
    const webhookMsg =
      stringOrNull((webhookTx as any).status_message) ||
      stringOrNull((webhookTx as any).statusMessage) ||
      stringOrNull((webhookTx as any).status_reason);
    if (webhookMsg) return webhookMsg;
  }
  return null;
}

logsRouter.get("/system", async (req, res) => {
  const withCount = String(req.query.count ?? "") === "1";
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 20)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const q = String(req.query.q ?? "").trim();
  const level = String(req.query.level ?? "").trim().toUpperCase();
  const customerId = String(req.query.customerId ?? "").trim();
  const fromRaw = String(req.query.from ?? "").trim();
  const toRaw = String(req.query.to ?? "").trim();
  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });
  const idsParam = req.query.ids;
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (typeof idsParam !== "undefined" && (idsEmpty || ids.length === 0)) {
    return res.json({ items: [], total: withCount ? 0 : null });
  }
  const where: Prisma.SystemLogWhereInput | undefined = q
    ? {
        OR: [
          { message: { contains: q, mode: "insensitive" } },
          { source: { contains: q, mode: "insensitive" } }
        ]
      }
    : undefined;
  const dateFilter = {
    createdAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  };
  const levelFilter = level ? { level } : null;
  const customerFilter = customerId
    ? ({ context: { path: ["customerId"], equals: customerId } } as Prisma.SystemLogWhereInput)
    : null;
  const finalWhere = {
    ...(where || {}),
    ...(dateFilter || {}),
    ...(levelFilter || {}),
    ...(customerFilter || {})
  } as Prisma.SystemLogWhereInput;
  if (ids.length) {
    (finalWhere as any).id = { in: ids };
  }
  const [items, total] = await Promise.all([
    prisma.systemLog.findMany({
      where: finalWhere,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: { id: true, level: true, source: true, message: true, context: true, createdAt: true }
    }),
    withCount ? prisma.systemLog.count({ where: finalWhere }) : Promise.resolve(null)
  ]);

  const subscriptionIds = new Set<string>();
  const customerIds = new Set<string>();
  const planIds = new Set<string>();
  const paymentIds = new Set<string>();
  const webhookIds = new Set<string>();

  for (const item of items) {
    const ctx: any = item.context || {};
    if (ctx.subscriptionId) subscriptionIds.add(String(ctx.subscriptionId));
    if (ctx.customerId) customerIds.add(String(ctx.customerId));
    if (ctx.planId) planIds.add(String(ctx.planId));
    if (ctx.paymentId) paymentIds.add(String(ctx.paymentId));
    if (ctx.webhookEventId) webhookIds.add(String(ctx.webhookEventId));
  }

  const [subscriptions, customers, plans, payments, webhooks] = await Promise.all([
    subscriptionIds.size
      ? prisma.subscription.findMany({
          where: { id: { in: Array.from(subscriptionIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            plan: { select: { name: true } }
          }
        })
      : Promise.resolve([]),
    customerIds.size
      ? prisma.customer.findMany({
          where: { id: { in: Array.from(customerIds) } },
          select: { id: true, name: true, email: true, phone: true }
        })
      : Promise.resolve([]),
    planIds.size
      ? prisma.subscriptionPlan.findMany({
          where: { id: { in: Array.from(planIds) } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    paymentIds.size
      ? prisma.payment.findMany({
          where: { id: { in: Array.from(paymentIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            subscription: { select: { plan: { select: { name: true } } } }
          }
        })
      : Promise.resolve([]),
    webhookIds.size
      ? prisma.webhookEvent.findMany({ where: { id: { in: Array.from(webhookIds) } }, select: { id: true, eventName: true } })
      : Promise.resolve([])
  ]);

  const subById = new Map(subscriptions.map((s) => [String(s.id), s]));
  const customerById = new Map(customers.map((c) => [String(c.id), c]));
  const planById = new Map(plans.map((p) => [String(p.id), p]));
  const paymentById = new Map(payments.map((p) => [String(p.id), p]));
  const webhookById = new Map(webhooks.map((w) => [String(w.id), w]));

  function inferActor(item: any) {
    const ctx: any = item.context || {};
    const candidate = ctx.actor || ctx.actorEmail || ctx.userEmail || ctx.adminEmail || ctx.user || ctx.email;
    if (candidate) return String(candidate);
    const source = String(item.source || "");
    if (source.startsWith("webhooks.")) return "Webhook";
    if (source.startsWith("jobs.") || source.startsWith("notifications.") || source.startsWith("process")) return "Sistema";
    if (source.startsWith("chatwoot.") || source.startsWith("smart_lists.")) return "Sistema";
    return "Admin API";
  }

  function formatEntity(item: any) {
    const ctx: any = item.context || {};
    if (ctx.paymentId && paymentById.has(String(ctx.paymentId))) {
      const p = paymentById.get(String(ctx.paymentId)) as any;
      const customer = p.customer?.name || p.customer?.email || p.customer?.phone || p.customerId;
      const plan = p.subscription?.plan?.name ? ` · ${p.subscription.plan.name}` : "";
      return `Pago · ${customer}${plan}`;
    }
    if (ctx.subscriptionId && subById.has(String(ctx.subscriptionId))) {
      const s = subById.get(String(ctx.subscriptionId)) as any;
      const customer = s.customer?.name || s.customer?.email || s.customer?.phone || s.customerId;
      const plan = s.plan?.name ? ` · ${s.plan.name}` : "";
      return `Suscripción · ${customer}${plan}`;
    }
    if (ctx.customerId && customerById.has(String(ctx.customerId))) {
      const c = customerById.get(String(ctx.customerId)) as any;
      return `Cliente · ${c.name || c.email || c.phone || c.id}`;
    }
    if (ctx.planId && planById.has(String(ctx.planId))) {
      const p = planById.get(String(ctx.planId)) as any;
      return `Plan · ${p.name || p.id}`;
    }
    if (ctx.webhookEventId && webhookById.has(String(ctx.webhookEventId))) {
      const w = webhookById.get(String(ctx.webhookEventId)) as any;
      return `Webhook · ${w.eventName || w.id}`;
    }
    return null;
  }

  const enriched = items.map((item: any) => ({
    ...item,
    actor: inferActor(item),
    entity: formatEntity(item)
  }));

  res.json({ items: enriched, total });
});

logsRouter.get("/jobs/health", async (_req, res) => {
  const key = String(process.env.JOBS_HEARTBEAT_KEY || "wompi-subs-jobs").trim() || "wompi-subs-jobs";
  const ttlSecondsRaw = Number(process.env.JOBS_HEALTH_TTL_SECONDS || 180);
  const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? Math.max(30, Math.trunc(ttlSecondsRaw)) : 180;
  const [heartbeat, pendingCount, runningCount, failedCount, nextJob] = await Promise.all([
    prisma.serviceHeartbeat.findUnique({ where: { key } }),
    prisma.retryJob.count({ where: { status: RetryJobStatus.PENDING } }),
    prisma.retryJob.count({ where: { status: RetryJobStatus.RUNNING } }),
    prisma.retryJob.count({ where: { status: RetryJobStatus.FAILED } }),
    prisma.retryJob.findFirst({
      where: { status: RetryJobStatus.PENDING },
      orderBy: { runAt: "asc" },
      select: { type: true, runAt: true }
    })
  ]);
  const now = new Date();
  const lastSeenAt = heartbeat?.lastSeenAt || null;
  const ageMs = lastSeenAt ? now.getTime() - lastSeenAt.getTime() : null;
  const healthy = lastSeenAt ? ageMs != null && ageMs <= ttlSeconds * 1000 : false;
  const nextJobAt = nextJob?.runAt ? nextJob.runAt.toISOString() : null;
  res.json({
    ok: !!lastSeenAt,
    healthy,
    key,
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    ageMs,
    ttlSeconds,
    pending: pendingCount,
    running: runningCount,
    failed: failedCount,
    nextJobType: nextJob?.type || null,
    nextJobAt
  });
});

logsRouter.get("/chatwoot/health", async (_req, res) => {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) {
    return res.status(503).json({ ok: false, error: "chatwoot_not_configured" });
  }

  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });

  const out: {
    ok: boolean;
    accountOk: boolean;
    inboxOk: boolean;
    baseUrl: string;
    accountId: number;
    inboxId: number;
    accountError?: string;
    inboxError?: string;
  } = {
    ok: false,
    accountOk: false,
    inboxOk: false,
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    inboxId: cfg.inboxId
  };

  try {
    await client.getAccount();
    out.accountOk = true;
  } catch (err: any) {
    out.accountError = String(err?.message || err || "account_check_failed");
  }

  try {
    await client.getInbox(cfg.inboxId);
    out.inboxOk = true;
  } catch (err: any) {
    out.inboxError = String(err?.message || err || "inbox_check_failed");
  }

  out.ok = out.accountOk && out.inboxOk;
  res.status(out.ok ? 200 : 502).json(out);
});

logsRouter.get("/system/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const item = await prisma.systemLog.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "not_found" });
  res.json({ item });
});

logsRouter.get("/payments", async (req, res) => {
  const withCount = String(req.query.count ?? "") === "1";
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 20)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const q = String(req.query.q ?? "").trim();
  const idsParam = req.query.ids;
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (typeof idsParam !== "undefined" && (idsEmpty || ids.length === 0)) {
    return res.json({ items: [], total: withCount ? 0 : null });
  }
  const statusRaw = String(req.query.status ?? "").trim().toUpperCase();
  const fromRaw = String(req.query.from ?? "").trim();
  const toRaw = String(req.query.to ?? "").trim();
  const tenantId = String(req.query.tenantId ?? "").trim();
  const planId = String(req.query.planId ?? "").trim();

  const statusFilter =
    statusRaw === "APPROVED"
      ? ["APPROVED"]
      : statusRaw === "PENDING"
        ? ["PENDING"]
        : statusRaw === "FAILED"
          ? ["DECLINED", "ERROR", "VOIDED"]
          : null;

  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });

  const where: Prisma.PaymentWhereInput = {
    ...(statusFilter ? { status: { in: statusFilter as any } } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(planId ? { subscription: { planId } } : {}),
    createdAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    },
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { wompiTransactionId: { contains: q, mode: "insensitive" } },
            { wompiPaymentLinkId: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customer: { email: { contains: q, mode: "insensitive" } } },
            { customer: { phone: { contains: q, mode: "insensitive" } } },
            { subscription: { plan: { name: { contains: q, mode: "insensitive" } } } }
          ]
        }
      : {})
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take,
      skip,
      where: ids.length ? { ...where, id: { in: ids } } : where,
      include: {
        subscription: { include: { plan: true } },
        customer: true,
        attempts: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    }),
    withCount ? prisma.payment.count({ where: ids.length ? { ...where, id: { in: ids } } : where }) : Promise.resolve(null)
  ]);
  const mappedItems = items.map((item: any) => {
    const lastAttempt = Array.isArray(item.attempts) ? item.attempts[0] : null;
    const failureCode =
      stringOrNull(lastAttempt?.errorCode) ||
      stringOrNull(lastAttempt?.status) ||
      null;
    const failureReason =
      stringOrNull(lastAttempt?.errorMessage) ||
      pickProviderFailureMessage(item.providerResponse) ||
      null;
    return {
      ...item,
      failureCode,
      failureReason
    };
  });
  res.json({ items: mappedItems, total });
});

logsRouter.post("/system/test", async (_req, res) => {
  await systemLog(LogLevel.WARN, "realtime.test", "Notificación de prueba en tiempo real", {
    createdAt: new Date().toISOString()
  }).catch(() => {});
  res.json({ ok: true });
});

logsRouter.post("/payments/recollect", async (req, res) => {
  const daysRaw = Number(req.query.days ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 30) : 7;
  const takeRaw = Number(req.query.take ?? 800);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 50), 2000) : 800;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.webhookEvent.findMany({
    where: { provider: WebhookProvider.WOMPI, receivedAt: { gte: since } },
    orderBy: { receivedAt: "desc" },
    take
  });

  let queuedProcess = 0;
  let queuedForward = 0;
  let skipped = 0;

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

    let hasPayment = false;
    if (txId) {
      const p = await prisma.payment.findUnique({ where: { wompiTransactionId: txId } });
      hasPayment = !!p;
    }
    if (!hasPayment && paymentLinkId) {
      const p = await prisma.payment.findUnique({ where: { wompiPaymentLinkId: paymentLinkId } });
      hasPayment = !!p;
    }

    if (hasPayment) {
      skipped += 1;
      continue;
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

  await systemLog(LogLevel.INFO, "logs.payments", "Recolectar pagos ejecutado", {
    days,
    take,
    queuedProcess,
    queuedForward,
    skipped
  }).catch(() => {});

  res.json({ ok: true, queuedProcess, queuedForward, skipped, days, take });
});

logsRouter.post("/payments/reconcile-pending", async (req, res) => {
  const minutesRaw = Number((req.query.minutes as any) ?? req.body?.minutes ?? 30);
  const minutes = Number.isFinite(minutesRaw) ? Math.min(Math.max(Math.trunc(minutesRaw), 1), 24 * 60) : 30;
  const takeRaw = Number((req.query.take as any) ?? req.body?.take ?? 300);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 1000) : 200;
  const tenantId = String((req.query.tenantId as any) ?? req.body?.tenantId ?? "").trim();
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

  await systemLog(LogLevel.INFO, "logs.payments", "Reconciliar pendientes ejecutado", {
    minutes,
    take,
    scanned: pending.length,
    reconciled,
    skipped,
    failed
  }).catch(() => {});

  res.json({
    ok: true,
    minutes,
    take,
    scanned: pending.length,
    reconciled,
    skipped,
    failed,
    errors: errors.slice(0, 50)
  });
});

logsRouter.post("/payments/reconcile", async (req, res) => {
  const paymentId = String(req.body?.paymentId || "").trim();
  const reference = String(req.body?.reference || "").trim();
  const wompiPaymentLinkId = String(req.body?.wompiPaymentLinkId || req.body?.paymentLinkId || "").trim();
  const wompiTransactionId = String(req.body?.wompiTransactionId || req.body?.transactionId || "").trim();

  if (!wompiTransactionId) {
    return res.status(400).json({ error: "missing_transaction_id" });
  }

  let payment =
    (paymentId ? await prisma.payment.findUnique({ where: { id: paymentId } }) : null) ||
    (reference ? await prisma.payment.findFirst({ where: { reference } }) : null) ||
    (wompiPaymentLinkId ? await prisma.payment.findFirst({ where: { wompiPaymentLinkId } }) : null) ||
    (wompiTransactionId ? await prisma.payment.findFirst({ where: { wompiTransactionId } }) : null);

  if (!payment) {
    return res.status(404).json({ error: "payment_not_found" });
  }

  if (payment.wompiTransactionId !== wompiTransactionId) {
    payment = await prisma.payment.update({
      where: { id: payment.id },
      data: { wompiTransactionId }
    });
  }

  const reconcile = await reconcileWompiTransaction({
    wompiTransactionId,
    tenantId: payment.tenantId,
    checksumPrefix: "manual-reconcile"
  }).catch((err: any) => ({
    ok: false as const,
    reason: "reconcile_failed" as const,
    message: String(err?.message || err || "reconcile_failed")
  }));

  await systemLog(LogLevel.INFO, "logs.payments", "Reconciliar pago ejecutado", {
    paymentId: payment.id,
    wompiTransactionId,
    reference: payment.reference || null,
    ok: reconcile.ok,
    reason: (reconcile as any)?.reason || null
  }).catch(() => {});

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

  res.json({ ok: reconcile.ok, reconcile, payment: refreshed });
});

logsRouter.get("/jobs", async (req, res) => {
  const withCount = String(req.query.count ?? "") === "1";
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 20)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const fromRaw = String(req.query.from ?? "").trim();
  const toRaw = String(req.query.to ?? "").trim();
  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });
  const where = {
    updatedAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  } as Prisma.RetryJobWhereInput;
  const [items, total] = await Promise.all([
    prisma.retryJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        runAt: true,
        lockedAt: true,
        lockedBy: true,
        updatedAt: true,
        payload: true,
        lastError: true
      }
    }),
    withCount ? prisma.retryJob.count({ where }) : Promise.resolve(null)
  ]);

  const subscriptionIds = new Set<string>();
  const paymentIds = new Set<string>();
  const customerIds = new Set<string>();
  const webhookIds = new Set<string>();
  const messageIds = new Set<string>();

  for (const item of items) {
    const payload: any = item.payload || {};
    if (payload.subscriptionId) subscriptionIds.add(String(payload.subscriptionId));
    if (payload.paymentId) paymentIds.add(String(payload.paymentId));
    if (payload.customerId) customerIds.add(String(payload.customerId));
    if (payload.webhookEventId) webhookIds.add(String(payload.webhookEventId));
    if (payload.messageId) messageIds.add(String(payload.messageId));
  }

  const [subscriptions, payments, customers, webhooks, messages] = await Promise.all([
    subscriptionIds.size
      ? prisma.subscription.findMany({
          where: { id: { in: Array.from(subscriptionIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            plan: { select: { name: true } }
          }
        })
      : Promise.resolve([]),
    paymentIds.size
      ? prisma.payment.findMany({
          where: { id: { in: Array.from(paymentIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } },
            subscription: { select: { plan: { select: { name: true } } } }
          }
        })
      : Promise.resolve([]),
    customerIds.size
      ? prisma.customer.findMany({
          where: { id: { in: Array.from(customerIds) } },
          select: { id: true, name: true, email: true, phone: true }
        })
      : Promise.resolve([]),
    webhookIds.size
      ? prisma.webhookEvent.findMany({
          where: { id: { in: Array.from(webhookIds) } },
          select: { id: true, eventName: true, processStatus: true, errorMessage: true }
        })
      : Promise.resolve([]),
    messageIds.size
      ? prisma.chatwootMessage.findMany({
          where: { id: { in: Array.from(messageIds) } },
          select: {
            id: true,
            customerId: true,
            customer: { select: { name: true, email: true, phone: true } }
          }
        })
      : Promise.resolve([])
  ]);

  const subById = new Map(subscriptions.map((s) => [String(s.id), s]));
  const paymentById = new Map(payments.map((p) => [String(p.id), p]));
  const customerById = new Map(customers.map((c) => [String(c.id), c]));
  const webhookById = new Map(webhooks.map((w) => [String(w.id), w]));
  const messageById = new Map(messages.map((m) => [String(m.id), m]));

  function formatTarget(payload: any) {
    const subscriptionId = payload?.subscriptionId ? String(payload.subscriptionId) : "";
    const paymentId = payload?.paymentId ? String(payload.paymentId) : "";
    const customerId = payload?.customerId ? String(payload.customerId) : "";
    const webhookEventId = payload?.webhookEventId ? String(payload.webhookEventId) : "";
    const messageId = payload?.messageId ? String(payload.messageId) : "";

    if (paymentId && paymentById.has(paymentId)) {
      const p: any = paymentById.get(paymentId);
      const customer = p.customer?.name || p.customer?.email || p.customer?.phone || p.customerId;
      const plan = p.subscription?.plan?.name ? ` · ${p.subscription.plan.name}` : "";
      return { label: `Pago · ${customer}${plan}`, id: paymentId };
    }
    if (subscriptionId && subById.has(subscriptionId)) {
      const s: any = subById.get(subscriptionId);
      const customer = s.customer?.name || s.customer?.email || s.customer?.phone || s.customerId;
      const plan = s.plan?.name ? ` · ${s.plan.name}` : "";
      return { label: `Suscripción · ${customer}${plan}`, id: subscriptionId };
    }
    if (messageId && messageById.has(messageId)) {
      const m: any = messageById.get(messageId);
      const customer = m.customer?.name || m.customer?.email || m.customer?.phone || m.customerId;
      return { label: `Mensaje · ${customer}`, id: messageId };
    }
    if (webhookEventId && webhookById.has(webhookEventId)) {
      const w: any = webhookById.get(webhookEventId);
      return { label: `Webhook · ${w.eventName || w.id}`, id: webhookEventId };
    }
    if (customerId && customerById.has(customerId)) {
      const c: any = customerById.get(customerId);
      return { label: `Cliente · ${c.name || c.email || c.phone || c.id}`, id: customerId };
    }
    if (subscriptionId) return { label: `Suscripción · ${subscriptionId}`, id: subscriptionId };
    if (paymentId) return { label: `Pago · ${paymentId}`, id: paymentId };
    if (customerId) return { label: `Cliente · ${customerId}`, id: customerId };
    if (messageId) return { label: `Mensaje · ${messageId}`, id: messageId };
    if (webhookEventId) return { label: `Webhook · ${webhookEventId}`, id: webhookEventId };
    return { label: "—", id: null };
  }

  const enriched = items.map((item) => {
    const payload: any = item.payload || {};
    const target = formatTarget(payload);
    const webhookEventId = payload?.webhookEventId ? String(payload.webhookEventId) : null;
    const webhook = webhookEventId && webhookById.has(webhookEventId) ? webhookById.get(webhookEventId) : null;
    return {
      ...item,
      targetLabel: target.label,
      targetId: target.id,
      webhookProcessStatus: webhook ? (webhook as any).processStatus : null,
      webhookErrorMessage: webhook ? (webhook as any).errorMessage : null
    };
  });

  res.json({ items: enriched, total });
});

logsRouter.get("/messages", async (req, res) => {
  const withCount = String(req.query.count ?? "") === "1";
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 20)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const fromRaw = String(req.query.from ?? "").trim();
  const toRaw = String(req.query.to ?? "").trim();
  const fromDate = parseDate(fromRaw) ?? defaultFromDate();
  const toDate = parseDate(toRaw, { end: true });
  const where = {
    createdAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  } as Prisma.ChatwootMessageWhereInput;
  const [items, total] = await Promise.all([
    prisma.chatwootMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } }
      }
    }),
    withCount ? prisma.chatwootMessage.count({ where }) : Promise.resolve(null)
  ]);
  res.json({ items, total });
});

logsRouter.post("/jobs/retry-failed", async (_req, res) => {
  const now = new Date();
  const result = await prisma.retryJob.updateMany({
    where: { status: RetryJobStatus.FAILED },
    data: { status: RetryJobStatus.PENDING, runAt: now, lockedAt: null, lockedBy: null }
  });
  res.json({ ok: true, retried: result.count });
});

logsRouter.post("/jobs/retry-forward", async (_req, res) => {
  const now = new Date();
  const result = await prisma.retryJob.updateMany({
    where: { status: RetryJobStatus.FAILED, type: "FORWARD_WOMPI_TO_SHOPIFY" },
    data: { status: RetryJobStatus.PENDING, runAt: now, lockedAt: null, lockedBy: null }
  });
  res.json({ ok: true, retried: result.count });
});

logsRouter.post("/jobs/:id/retry", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const job = await prisma.retryJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ error: "not_found" });
  await prisma.retryJob.update({
    where: { id },
    data: { status: RetryJobStatus.PENDING, runAt: new Date(), lockedAt: null, lockedBy: null }
  });
  res.json({ ok: true });
});

logsRouter.post("/webhooks/retry-failed", async (_req, res) => {
  const failed = await prisma.webhookEvent.findMany({
    where: { provider: WebhookProvider.WOMPI, processStatus: WebhookProcessStatus.FAILED },
    orderBy: { receivedAt: "desc" },
    take: 200
  });
  if (!failed.length) return res.json({ ok: true, retried: 0 });

  const pendingJobs = await prisma.retryJob.findMany({
    where: {
      type: RetryJobType.PROCESS_WOMPI_EVENT,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] }
    }
  });
  const pendingIds = new Set(
    pendingJobs
      .map((j: any) => (j.payload as any)?.webhookEventId)
      .filter((id: any) => typeof id === "string" && id.length)
  );

  const toRetry = failed.filter((event) => !pendingIds.has(event.id));
  if (!toRetry.length) return res.json({ ok: true, retried: 0, skipped: failed.length });

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

  res.json({ ok: true, retried: toRetry.length, skipped: failed.length - toRetry.length });
});

logsRouter.post("/webhooks/:id/retry", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const event = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!event) return res.status(404).json({ error: "not_found" });

  const pending = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.PROCESS_WOMPI_EVENT,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
      payload: { path: ["webhookEventId"], equals: id } as any
    }
  });
  if (pending) return res.json({ ok: true, retried: 0, reason: "already_pending" });

  await prisma.webhookEvent.update({
    where: { id },
    data: { processStatus: WebhookProcessStatus.RECEIVED, errorMessage: null, processedAt: null }
  });
  await prisma.retryJob.create({
    data: { type: RetryJobType.PROCESS_WOMPI_EVENT, payload: { webhookEventId: id } }
  });
  res.json({ ok: true, retried: 1 });
});
