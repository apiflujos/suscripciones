import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { PlanIntervalUnit, PlanType } from "@prisma/client";

const createPlanSchema = z.object({
  name: z.string().min(1),
  priceInCents: z.number().int().positive(),
  currency: z.string().min(3).max(3).default("COP"),
  intervalUnit: z.nativeEnum(PlanIntervalUnit),
  intervalCount: z.number().int().positive().default(1),
  collectionMode: z.enum(["MANUAL_LINK", "AUTO_LINK", "AUTO_DEBIT"]).optional().default("MANUAL_LINK"),
  planType: z.nativeEnum(PlanType).optional(),
  active: z.boolean().optional(),
  metadata: z.any().optional()
});

export const plansRouter = express.Router();

plansRouter.get("/", async (_req, res) => {
  const req = _req as any;
  const takeRaw = Number(req?.query?.take ?? 200);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 200;
  const q = String(req?.query?.q ?? "").trim();
  const mode = String(req?.query?.collectionMode ?? "").trim();

  const where: any = { NOT: { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } } } as any;
  const and: any[] = [];
  if (q) and.push({ name: { contains: q, mode: "insensitive" } });
  if (mode) and.push({ metadata: { path: ["collectionMode"], equals: mode } } as any);
  if (and.length) where.AND = and;

  const items = await prisma.subscriptionPlan.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take
  });
  res.json({ items });
});

plansRouter.post("/", async (req, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const { collectionMode, planType, metadata, ...rest } = parsed.data;
  const mergedMetadata = {
    ...(metadata && typeof metadata === "object" ? (metadata as any) : {}),
    collectionMode
  };

  const computedPlanType: PlanType = planType ?? (collectionMode === "MANUAL_LINK" ? PlanType.manual_link : PlanType.auto_subscription);
  const plan = await prisma.subscriptionPlan.create({ data: { ...(rest as any), planType: computedPlanType as any, metadata: mergedMetadata as any } });
  res.status(201).json({ plan });
});
