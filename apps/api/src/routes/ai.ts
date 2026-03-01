import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { LogLevel, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { systemLog } from "../services/systemLog";
import { getEffectiveTenantId } from "../services/tenantContext";
import { getModuleAccess } from "../services/moduleAccess";

export const aiRouter = express.Router();

const askSchema = z.object({
  question: z.string().min(3).max(2000),
  from: z.string().optional(),
  to: z.string().optional(),
  tenantId: z.string().optional(),
  customerId: z.string().optional(),
  productId: z.string().optional(),
  scope: z.string().optional()
});

aiRouter.post("/ask", async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const requestId = crypto.randomUUID();
  const tenantId = parsed.data.tenantId ?? (await getEffectiveTenantId(req)) ?? null;
  const aiAccess = await getModuleAccess(tenantId, "ai");
  if (!aiAccess.enabled) return res.status(403).json({ error: "ai_disabled", reason: aiAccess.reason });
  const payload = {
    requestId,
    question: parsed.data.question,
    from: parsed.data.from || null,
    to: parsed.data.to || null,
    tenantId: tenantId || null,
    customerId: parsed.data.customerId || null,
    productId: parsed.data.productId || null,
    scope: parsed.data.scope || null,
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
  const tenantId = await getEffectiveTenantId(req);
  const aiAccess = await getModuleAccess(tenantId, "ai");
  if (!aiAccess.enabled) return res.status(403).json({ error: "ai_disabled", reason: aiAccess.reason });
  const take = Math.min(50, Math.max(1, Number(req.query.take ?? 20)));
  const scope = String(req.query.scope || "").trim();
  const customerId = String(req.query.customerId || "").trim();
  const productId = String(req.query.productId || "").trim();
  const andFilters: any[] = [];
  if (tenantId) andFilters.push({ context: { path: ["tenantId"], equals: tenantId } });
  if (scope) andFilters.push({ context: { path: ["scope"], equals: scope } });
  if (customerId) andFilters.push({ context: { path: ["customerId"], equals: customerId } });
  if (productId) andFilters.push({ context: { path: ["productId"], equals: productId } });

  const items = await prisma.systemLog.findMany({
    where: {
      source: { startsWith: "ai." },
      ...(andFilters.length ? { AND: andFilters } : {})
    },
    orderBy: { createdAt: "desc" },
    take
  });
  const filtered = items.filter((i) => {
    const ctx: any = i.context || {};
    return Boolean(ctx?.answer || ctx?.error);
  });
  res.json({ items: filtered });
});
