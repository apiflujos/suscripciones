import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaUserRole } from "@prisma/client";
import { createSaSession, verifyPassword } from "@suscripciones/core/services/superAdminAuth";

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
  const rate = checkRateLimit(req);
  if (!rate.ok) {
    return Response.json({ error: "rate_limited", retryAfterMs: rate.retryAfterMs }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  const user = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user) {
    const total = await prisma.saUser.count();
    if (total === 0) return Response.json({ error: "no_admin_users" }, { status: 500 });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!user.active) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!verifyPassword(password, user.passwordHash)) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (user.role === SaUserRole.SUPER_ADMIN) {
    try {
      const ip = null;
      const ua = req.headers.get("user-agent") || null;
      const session = await createSaSession({ email: user.email, password, ip, userAgent: ua });
      return Response.json({
        kind: "super_admin",
        email: user.email,
        role: "SUPER_ADMIN",
        saToken: session.token,
        saRefreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString()
      });
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : "";
      if (msg === "no_super_admin_user") return Response.json({ error: "no_super_admin_user" }, { status: 500 });
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const role = user.role === SaUserRole.ADMIN ? "ADMIN" : "AGENT";
  return Response.json({ kind: "user", email: user.email, role, tenantId: user.tenantId ?? null });
}
