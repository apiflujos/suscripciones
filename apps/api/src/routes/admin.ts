import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";

function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}

export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const tokenFromAuth = auth.startsWith("Bearer ") ? auth : "";
  const tokenFromHeader = req.header("x-admin-token") || "";
  const token = normalizeToken(tokenFromAuth || tokenFromHeader || "");

  const expectedRaw = process.env.ADMIN_API_TOKEN || "";
  const expectedTokens = String(expectedRaw || "")
    .split(/[,\n]/)
    .map((t) => normalizeToken(t))
    .filter(Boolean);

  if (!token || !expectedTokens.length || !expectedTokens.includes(token)) {
    const reason = !expectedTokens.length ? "expected_not_configured" : !token ? "missing_token" : "token_mismatch";
    const debugAuth = (process.env.DEBUG_AUTH || "").trim() === "1";
    res.status(401).json(
      debugAuth
        ? {
            error: "unauthorized",
            reason,
            hasAuthorization: !!auth,
            hasXAdminToken: !!tokenFromHeader,
            receivedLength: token.length,
            expectedCount: expectedTokens.length,
            expectedLengths: expectedTokens.map((t) => t.length)
          }
        : {
            error: "unauthorized",
            reason,
            hasAuthorization: !!auth,
            hasXAdminToken: !!tokenFromHeader
          }
    );
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
