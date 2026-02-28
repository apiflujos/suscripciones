import express from "express";
import { prisma } from "../db/prisma";
import { getEffectiveTenantId } from "../services/tenantContext";

export const paymentsRouter = express.Router();

paymentsRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "missing_payment_id" });

  const tenantId = await getEffectiveTenantId(req);
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      subscription: { include: { tenantLinks: true } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!payment) return res.status(404).json({ error: "payment_not_found" });

  if (tenantId) {
    const allowed =
      payment.tenantId === tenantId ||
      payment.subscription?.tenantId === tenantId ||
      (payment.subscription?.tenantLinks || []).some((t: any) => t.tenantId === tenantId);
    if (!allowed) return res.status(404).json({ error: "payment_not_found" });
  }

  const lastAttempt = payment.attempts?.[0] || null;
  res.json({
    payment: {
      id: payment.id,
      status: payment.status,
      paidAt: payment.paidAt,
      failedAt: payment.failedAt,
      wompiTransactionId: payment.wompiTransactionId
    },
    lastAttempt: lastAttempt
      ? {
          id: lastAttempt.id,
          status: lastAttempt.status,
          errorCode: lastAttempt.errorCode,
          errorMessage: lastAttempt.errorMessage,
          createdAt: lastAttempt.createdAt
        }
      : null
  });
});
