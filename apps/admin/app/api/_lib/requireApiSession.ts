import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, AdminRole, verifyAdminSessionToken } from "../../../lib/session";

type Ok = { ok: true; session: { email: string; role: AdminRole; tenantId?: string | null } };
type Fail = { ok: false; response: Response };

export async function requireApiSession(opts?: { roles?: AdminRole[] }): Promise<Ok | Fail> {
  const c = await cookies();
  const token = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = token ? await verifyAdminSessionToken(token) : null;
  if (!session) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (opts?.roles?.length && !opts.roles.includes(session.role)) {
    return { ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, session };
}
