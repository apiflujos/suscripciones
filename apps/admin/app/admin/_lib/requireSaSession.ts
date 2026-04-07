import { logger } from "@suscripciones/core/lib/logger";
import { getSaSessionByToken, normalizeSaToken, touchSaSession } from "@suscripciones/core/services/superAdminAuth";

export async function requireSaSession(req: Request): Promise<
  | { ok: true; sa: { email: string; userId: string; role: string; sessionId: string } }
  | { ok: false; response: Response }
> {
  const tokenRaw = req.headers.get("x-sa-session") || req.headers.get("authorization") || "";
  const token = normalizeSaToken(tokenRaw);
  const out = await getSaSessionByToken(token);
  if (!out) {
    return { ok: false, response: Response.json({ error: "unauthorized_sa" }, { status: 401 }) };
  }
  await touchSaSession(token).catch((err) => {
    logger.warn({ err, sessionId: out.session.id, userId: out.user.id }, "requireSaSession: fallo renovando sesión SA");
  });
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
