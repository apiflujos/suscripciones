import { permissionsForPath, hasPermissions } from "../../../lib/rbac";
import { normalizeBearer, verifyJwt } from "../../../lib/jwt";

type Ok = { ok: true; session: { sub: string; role: string; permissions: string[]; tenantId?: string | null } };
type Fail = { ok: false; response: Response };

export async function requireApiSession(req?: Request, opts?: { roles?: string[] }): Promise<Ok | Fail> {
  const headers = req?.headers || null;
  const auth = headers?.get("authorization") || "";
  const tokenFromAuth = auth.toLowerCase().startsWith("bearer ") ? auth : "";
  const tokenFromHeader = headers?.get("x-auth-token") || "";
  const token = normalizeBearer(tokenFromAuth || tokenFromHeader || "");

  if (!token) {
    return { ok: false, response: Response.json({ error: "unauthorized", reason: "missing_token" }, { status: 401 }) };
  }

  const claims = await verifyJwt(token);
  if (!claims) {
    return { ok: false, response: Response.json({ error: "unauthorized", reason: "invalid_token" }, { status: 401 }) };
  }

  if (req) {
    const pathname = new URL(req.url).pathname;
    const required = permissionsForPath(pathname, req.method);
    if (required && !hasPermissions(required, claims.permissions)) {
      return { ok: false, response: Response.json({ error: "forbidden", reason: "missing_permissions" }, { status: 403 }) };
    }
  }

  if (opts?.roles?.length && !opts.roles.includes(String(claims.role))) {
    return { ok: false, response: Response.json({ error: "forbidden", reason: "role_required" }, { status: 403 }) };
  }

  return { ok: true, session: { sub: claims.sub, role: claims.role, permissions: claims.permissions, tenantId: claims.tenantId || null } };
}
