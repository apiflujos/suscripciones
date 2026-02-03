import express from "express";
import { prisma } from "../db/prisma";

export const logsRouter = express.Router();

logsRouter.get("/system", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 100)));
  const items = await prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take });
  res.json({ items });
});

logsRouter.get("/payments", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 50)));
  const items = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { subscription: true, customer: true, attempts: { orderBy: { createdAt: "desc" }, take: 5 } }
  });
  res.json({ items });
});

logsRouter.get("/jobs", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 50)));
  const items = await prisma.retryJob.findMany({ orderBy: { updatedAt: "desc" }, take });
  res.json({ items });
});

