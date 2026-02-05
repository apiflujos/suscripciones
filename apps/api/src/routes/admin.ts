import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";

export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const tokenFromAuth = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const tokenFromHeader = req.header("x-admin-token") || "";
  const token = (tokenFromAuth || tokenFromHeader || "").trim();

  const expectedRaw = process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "";
  const expected = (expectedRaw.startsWith("Bearer ") ? expectedRaw.slice("Bearer ".length) : expectedRaw).trim();

  if (!token || !expected || token !== expected) {
    const reason = !expected ? "expected_not_configured" : !token ? "missing_token" : "token_mismatch";
    res.status(401).json({
      error: "unauthorized",
      reason,
      hasAuthorization: !!auth,
      hasXAdminToken: !!tokenFromHeader
    });
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
