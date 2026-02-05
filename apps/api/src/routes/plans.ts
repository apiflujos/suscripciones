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
  collectionMode: z.enum(["MANUAL_LINK", "AUTO_LINK", "AUTO_DEBIT"]).optional().default("MANUAL_LINK"),
  active: z.boolean().optional(),
  metadata: z.any().optional()
});

export const plansRouter = express.Router();

plansRouter.get("/", async (_req, res) => {
  const items = await prisma.subscriptionPlan.findMany({
    where: { NOT: { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } } as any,
    orderBy: { createdAt: "desc" }
  });
  res.json({ items });
});

plansRouter.post("/", async (req, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const { collectionMode, metadata, ...rest } = parsed.data;
  const mergedMetadata = {
    ...(metadata && typeof metadata === "object" ? (metadata as any) : {}),
    collectionMode
  };

  const plan = await prisma.subscriptionPlan.create({ data: { ...(rest as any), metadata: mergedMetadata as any } });
  res.status(201).json({ plan });
});
