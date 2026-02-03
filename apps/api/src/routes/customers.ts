import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";

const createCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  metadata: z.any().optional()
});

export const customersRouter = express.Router();

customersRouter.get("/", async (_req, res) => {
  const items = await prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ items });
});

customersRouter.post("/", async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const customer = await prisma.customer.create({ data: parsed.data as any });
  res.status(201).json({ customer });
});

