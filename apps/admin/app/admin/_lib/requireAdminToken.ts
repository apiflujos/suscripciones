import { permissionsForPath, hasPermissions } from "../../../lib/rbac";
import { normalizeBearer, verifyJwt } from "../../../lib/jwt";
import { prisma } from "@suscripciones/database";
import { logger } from "@suscripciones/core/lib/logger";

export async function requireAdminToken(req: Request): Promise<
  | { ok: true; claims: { sub: string; role: string; permissions: string[]; tenantId?: string | null } }
  | { ok: false; response: Response }
> {
  const auth = req.headers.get("authorization") || "";
  const tokenFromAuth = auth.toLowerCase().startsWith("bearer ") ? auth : "";
  const tokenFromHeader = req.headers.get("x-auth-token") || "";
  const token = normalizeBearer(tokenFromAuth || tokenFromHeader || "");

  if (!token) {
    return { ok: false, response: Response.json({ error: "unauthorized", reason: "missing_token" }, { status: 401 }) };
  }

  const claims = await verifyJwt(token);
  if (!claims) {
    return { ok: false, response: Response.json({ error: "unauthorized", reason: "invalid_token" }, { status: 401 }) };
  }

  const tokenId = (claims as any)?.tokenId ? String((claims as any).tokenId) : "";
  if (tokenId) {
    const apiToken = await prisma.apiToken.findUnique({ where: { id: tokenId } });
    if (!apiToken || apiToken.revokedAt || apiToken.expiresAt <= new Date()) {
      return { ok: false, response: Response.json({ error: "unauthorized", reason: "token_revoked" }, { status: 401 }) };
    }
    if (claims.tenantId && apiToken.tenantId && String(claims.tenantId) !== String(apiToken.tenantId)) {
      return { ok: false, response: Response.json({ error: "unauthorized", reason: "tenant_mismatch" }, { status: 401 }) };
    }
    await prisma.apiToken.updateMany({
      where: { id: tokenId },
      data: { lastUsedAt: new Date() }
    }).catch((err) => {
      logger.warn({ err, tokenId }, "requireAdminToken: fallo actualizando lastUsedAt de apiToken");
    });
  }

  const pathname = new URL(req.url).pathname;
  const required = permissionsForPath(pathname, req.method);
  if (required && !hasPermissions(required, claims.permissions)) {
    return { ok: false, response: Response.json({ error: "forbidden", reason: "missing_permissions" }, { status: 403 }) };
  }

  return { ok: true, claims };
}
