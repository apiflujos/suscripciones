import { cookies } from "next/headers";
import { getSaSessionByToken, normalizeSaToken, touchSaSession } from "@suscripciones/core/services/superAdminAuth";
import { SA_COOKIE } from "../../__sa/saApi";

type Ok = { ok: true; sa: { email: string; userId: string; role: string; sessionId: string } };
type Fail = { ok: false; response: Response };

export async function requireSaSessionFromCookie(): Promise<Ok | Fail> {
  const c = await cookies();
  const raw = c.get(SA_COOKIE)?.value || "";
  const token = normalizeSaToken(raw);
  const out = await getSaSessionByToken(token);
  if (!out) {
    return { ok: false, response: Response.json({ error: "unauthorized_sa" }, { status: 401 }) };
  }
  await touchSaSession(token).catch(() => {});
  return {
    ok: true,
    sa: {
      email: out.user.email,
      userId: out.user.id,
      role: out.user.role,
      sessionId: out.session.id
    }
  };
}
