import crypto from "node:crypto";

function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}

export function requireAdminToken(req: Request): { ok: true; token: string } | { ok: false; response: Response } {
  const auth = req.headers.get("authorization") || "";
  const tokenFromAuth = auth.startsWith("Bearer ") ? auth : "";
  const tokenFromHeader = req.headers.get("x-admin-token") || "";
  const token = normalizeToken(tokenFromAuth || tokenFromHeader || "");

  const expectedRaw = process.env.ADMIN_API_TOKEN || "";
  const expectedTokens = String(expectedRaw || "")
    .split(/[,\n]/)
    .map((t) => normalizeToken(t))
    .filter(Boolean);

  const matchesToken = expectedTokens.some((expected) => {
    if (expected.length !== token.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    } catch {
      return false;
    }
  });

  if (!token || !expectedTokens.length || !matchesToken) {
    const reason = !expectedTokens.length ? "expected_not_configured" : !token ? "missing_token" : "token_mismatch";
    const debugAuth = (process.env.DEBUG_AUTH || "").trim() === "1" && process.env.NODE_ENV !== "production";
    const payload = debugAuth
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
        };
    return { ok: false, response: Response.json(payload, { status: 401 }) };
  }

  return { ok: true, token };
}
