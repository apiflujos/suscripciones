import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { createSaSession } from "@suscripciones/core/services/superAdminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
let loginRequests = 0;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function getClientKey(req: Request) {
  const forwarded = String(req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  return forwarded || "unknown";
}

function checkRateLimit(req: Request) {
  const key = getClientKey(req);
  const now = Date.now();
  loginRequests += 1;
  if (loginRequests % 200 === 0 && loginAttempts.size) {
    for (const [k, v] of loginAttempts.entries()) {
      if (now >= v.resetAt) loginAttempts.delete(k);
    }
  }
  const existing = loginAttempts.get(key);
  if (!existing || now >= existing.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true };
  }
  if (existing.count >= LOGIN_MAX_ATTEMPTS) {
    return { ok: false, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { ok: true };
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const rate = checkRateLimit(req);
  if (!rate.ok) {
    return Response.json({ error: "rate_limited", retryAfterMs: rate.retryAfterMs }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent") || null;
    const session = await createSaSession({
      email: parsed.data.email,
      password: parsed.data.password,
      ip,
      userAgent: ua
    });
    return Response.json({
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      email: session.email
    });
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "";
    if (msg === "no_super_admin_user") return Response.json({ error: "no_super_admin_user" }, { status: 500 });
    return Response.json({ error: "unauthorized_sa" }, { status: 401 });
  }
}
