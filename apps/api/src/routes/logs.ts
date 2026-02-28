import express from "express";
import { prisma } from "../db/prisma";
import { Prisma, RetryJobStatus, RetryJobType, WebhookProvider } from "@prisma/client";
import { classifyReference } from "../webhooks/wompi/classifyReference";
import { systemLog } from "../services/systemLog";
import { LogLevel } from "@prisma/client";

export const logsRouter = express.Router();

logsRouter.get("/system", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 100)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const q = String(req.query.q ?? "").trim();
  const where: Prisma.SystemLogWhereInput | undefined = q
    ? {
        OR: [
          { message: { contains: q, mode: "insensitive" } },
          { source: { contains: q, mode: "insensitive" } }
        ]
      }
    : undefined;
  const items = await prisma.systemLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip });
  res.json({ items });
});

logsRouter.get("/system/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const item = await prisma.systemLog.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "not_found" });
  res.json({ item });
});

logsRouter.get("/payments", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 50)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const q = String(req.query.q ?? "").trim();
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

  const fromDate = fromRaw ? new Date(fromRaw) : null;
  const toDate = toRaw ? new Date(toRaw) : null;

  const where: Prisma.PaymentWhereInput = {
    ...(statusFilter ? { status: { in: statusFilter as any } } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(planId ? { subscription: { planId } } : {}),
    ...(fromDate || toDate
      ? {
          createdAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lt: toDate } : {})
          }
        }
      : {}),
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
  const items = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take,
    skip,
    where,
    include: { subscription: { include: { plan: true } }, customer: true, attempts: { orderBy: { createdAt: "desc" }, take: 5 } }
  });
  res.json({ items });
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

logsRouter.get("/jobs", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 50)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const items = await prisma.retryJob.findMany({ orderBy: { updatedAt: "desc" }, take, skip });
  res.json({ items });
});

logsRouter.get("/messages", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 100)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const items = await prisma.chatwootMessage.findMany({
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { customer: true, subscription: true, payment: true }
  });
  res.json({ items });
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
