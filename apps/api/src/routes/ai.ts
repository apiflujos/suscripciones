import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { LogLevel, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { systemLog } from "../services/systemLog";

export const aiRouter = express.Router();

const askSchema = z.object({
  question: z.string().min(3).max(2000),
  from: z.string().optional(),
  to: z.string().optional(),
  tenantId: z.string().optional(),
  customerId: z.string().optional()
});

aiRouter.post("/ask", async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const requestId = crypto.randomUUID();
  const payload = {
    requestId,
    question: parsed.data.question,
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    tenantId: parsed.data.tenantId || null,
    customerId: parsed.data.customerId || null,
    requestedAt: new Date().toISOString()
  };

  await prisma.retryJob.create({
    data: {
      type: RetryJobType.AI_ASSIST,
      runAt: new Date(),
      maxAttempts: 2,
      payload
    }
  });

  await systemLog(LogLevel.INFO, "ai.chat.requested", "Solicitud IA registrada", payload).catch(() => {});
  res.json({ requestId });
});

aiRouter.get("/history", async (req, res) => {
  const take = Math.min(50, Math.max(1, Number(req.query.take ?? 20)));
  const items = await prisma.systemLog.findMany({
    where: { source: { startsWith: "ai." } },
    orderBy: { createdAt: "desc" },
    take
  });
  const filtered = items.filter((i) => {
    const ctx: any = i.context || {};
    return Boolean(ctx?.answer || ctx?.error);
  });
  res.json({ items: filtered });
});
