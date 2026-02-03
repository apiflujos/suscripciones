import type { Request, Response } from "express";
import { prisma } from "../db/prisma";

export async function health(_req: Request, res: Response) {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
}

