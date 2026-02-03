import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { PlanIntervalUnit } from "@prisma/client";

const createPlanSchema = z.object({
  name: z.string().min(1),
  priceInCents: z.number().int().positive(),
  currency: z.string().min(3).max(3).default("COP"),
  intervalUnit: z.nativeEnum(PlanIntervalUnit),
  intervalCount: z.number().int().positive().default(1),
  active: z.boolean().optional(),
  metadata: z.any().optional()
});

export const plansRouter = express.Router();

plansRouter.get("/", async (_req, res) => {
  const items = await prisma.subscriptionPlan.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ items });
});

plansRouter.post("/", async (req, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const plan = await prisma.subscriptionPlan.create({ data: parsed.data as any });
  res.status(201).json({ plan });
});

