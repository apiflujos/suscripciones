import express from "express";
import { prisma } from "../db/prisma";
import { RetryJobStatus } from "@prisma/client";

export const logsRouter = express.Router();

logsRouter.get("/system", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 100)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));
  const items = await prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take, skip });
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
  const items = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: { subscription: true, customer: true, attempts: { orderBy: { createdAt: "desc" }, take: 5 } }
  });
  res.json({ items });
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
