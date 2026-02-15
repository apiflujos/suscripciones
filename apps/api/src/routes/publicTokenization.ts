import express from "express";
import { prisma } from "../db/prisma";

export const publicTokenizationRouter = express.Router();

publicTokenizationRouter.get("/tokenization-links/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "missing_token" });

  const customer = await prisma.customer.findFirst({
    where: { metadata: { path: ["tokenizationLink", "token"], equals: token } as any }
  });
  if (!customer) return res.status(404).json({ error: "token_not_found" });

  const meta: any = customer.metadata ?? {};
  const link = meta?.tokenizationLink ?? {};
  const expiresAt = link?.expiresAt ? new Date(link.expiresAt) : null;
  const usedAt = link?.usedAt ? new Date(link.usedAt) : null;

  if (usedAt) return res.status(410).json({ error: "token_used" });
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "token_expired" });
  }

  res.json({
    ok: true,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email
    },
    expiresAt: expiresAt ? expiresAt.toISOString() : null
  });
});
