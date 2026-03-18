import { permissionsForPath, hasPermissions } from "../../../lib/rbac";
import { normalizeBearer, verifyJwt } from "../../../lib/jwt";

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

  const pathname = new URL(req.url).pathname;
  const required = permissionsForPath(pathname, req.method);
  if (required && !hasPermissions(required, claims.permissions)) {
    return { ok: false, response: Response.json({ error: "forbidden", reason: "missing_permissions" }, { status: 403 }) };
  }

  return { ok: true, claims };
}
