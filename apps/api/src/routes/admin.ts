import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";

export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export async function listWebhookEvents(_req: Request, res: Response) {
  const items = await prisma.webhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: 50
  });
  res.json({ items });
}

