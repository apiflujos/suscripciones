import type { Request, Response } from "express";
import { prisma } from "../db/prisma";

// Liveness probe (no external dependencies)
export async function healthz(_req: Request, res: Response) {
  res.json({ ok: true });
}

// Readiness probe (requires DB connectivity)
export async function health(_req: Request, res: Response) {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
}
