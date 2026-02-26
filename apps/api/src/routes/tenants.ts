import express from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";

const createTenantSchema = z.object({
  name: z.string().min(1)
});

export const tenantsRouter = express.Router();

tenantsRouter.get("/", async (_req, res) => {
  const items = await prisma.saTenant.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  res.json({ items });
});

tenantsRouter.post("/", async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const name = parsed.data.name.trim();
  const existing = await prisma.saTenant.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return res.status(200).json({ tenant: existing, created: false });

  const tenant = await prisma.saTenant.create({ data: { name, active: true } });
  const superAdmins = await prisma.saUser.findMany({ where: { role: "SUPER_ADMIN", active: true }, select: { id: true } });
  if (superAdmins.length) {
    await prisma.saUserTenant.createMany({
      data: superAdmins.map((u: any) => ({ userId: u.id, tenantId: tenant.id })),
      skipDuplicates: true
    });
  }
  res.status(201).json({ tenant, created: true });
});
