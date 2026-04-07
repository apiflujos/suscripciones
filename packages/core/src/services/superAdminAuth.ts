import crypto from "node:crypto";
import { SaUserRole } from "@prisma/client";
import { prisma } from "../db/prisma";
import { sha256Hex, timingSafeEqualHex } from "../lib/crypto";
import { logger } from "../lib/logger";
import { getDefaultTenantId } from "./tenantContext";

function normalize(v: unknown) {
  return String(v || "").trim();
}

export const SUPER_ADMIN_EMAIL = normalize(process.env.SUPER_ADMIN_EMAIL);
const SUPER_ADMIN_PASSWORD = normalize(process.env.SUPER_ADMIN_PASSWORD);
const SUPER_ADMIN_RESET_PASSWORD = normalize(process.env.SUPER_ADMIN_RESET_PASSWORD || "0") === "1";
const SUPER_ADMIN_TENANT_ID =
  normalize(process.env.SUPER_ADMIN_TENANT_ID) || normalize(process.env.SA_TENANT_ID) || "";
const DEFAULT_TENANT_NAME =
  normalize(process.env.SA_DEFAULT_TENANT_NAME) || normalize(process.env.DEFAULT_TENANT_NAME);

export function hashPassword(pw: string) {
  const password = String(pw || "");
  if (!password) throw new Error("password_required");
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 200_000;
  const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${iterations}$${salt}$${digest}`;
}

export function verifyPassword(pw: string, stored: string) {
  const s = String(stored || "");
  const parts = s.split("$");
  if (parts.length !== 4) return false;
  if (parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const digest = parts[3];
  if (!Number.isFinite(iterations) || iterations < 50_000) return false;
  if (!salt || !digest) return false;

  try {
    const got = crypto.pbkdf2Sync(String(pw || ""), salt, iterations, 32, "sha256").toString("hex");
    return timingSafeEqualHex(got, digest);
  } catch {
    return false;
  }
}

export async function ensureBootstrapSuperAdmin() {
  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) return;
  const email = SUPER_ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

  const fallbackTenantId = SUPER_ADMIN_TENANT_ID || (await ensureDefaultTenantFromEnv()) || (await getDefaultTenantId());
  if (!fallbackTenantId) return;

  if (existing) {
    const updates: any = {};
    if (existing.role !== SaUserRole.SUPER_ADMIN) updates.role = SaUserRole.SUPER_ADMIN;
    if (!existing.active) updates.active = true;
    if (SUPER_ADMIN_RESET_PASSWORD) updates.passwordHash = hashPassword(SUPER_ADMIN_PASSWORD);
    if (existing.tenantId !== fallbackTenantId) updates.tenantId = fallbackTenantId;

    if (Object.keys(updates).length > 0) {
      await prisma.saUser.update({ where: { id: existing.id }, data: updates });
    }
    return;
  }

  await prisma.saUser.create({
    data: {
      email,
      passwordHash: hashPassword(SUPER_ADMIN_PASSWORD),
      role: SaUserRole.SUPER_ADMIN,
      active: true,
      tenantId: fallbackTenantId
    } as any
  });
}

async function ensureDefaultTenantFromEnv(): Promise<string | null> {
  if (!DEFAULT_TENANT_NAME) return null;
  const existing = await prisma.saTenant.findFirst({
    where: { name: { equals: DEFAULT_TENANT_NAME, mode: "insensitive" } }
  });
  if (existing?.id) return existing.id;
  const created = await prisma.saTenant.create({
    data: { name: DEFAULT_TENANT_NAME, active: true }
  });
  return created.id || null;
}

export function normalizeSaToken(v: unknown) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  if (raw.startsWith("Bearer ")) return raw.slice("Bearer ".length).trim();
  return raw;
}

export async function createSaSession(args: { email: string; password: string; ip?: string | null; userAgent?: string | null }) {
  const hasAnySuperAdmin = await prisma.saUser.count({ where: { role: SaUserRole.SUPER_ADMIN, active: true } });
  if (!hasAnySuperAdmin) throw new Error("no_super_admin_user");

  const email = String(args.email || "").trim().toLowerCase();
  const user = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user || !user.active || user.role !== SaUserRole.SUPER_ADMIN) throw new Error("unauthorized_sa");
  if (!verifyPassword(args.password, user.passwordHash)) throw new Error("unauthorized_sa");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const refreshTokenHash = sha256Hex(refreshToken);
  const now = new Date();
  const ttlHoursRaw = Number(process.env.SA_SESSION_TTL_HOURS || "24");
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : 24;
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const refreshDaysRaw = Number(process.env.SA_REFRESH_TTL_DAYS || "14");
  const refreshDays = Number.isFinite(refreshDaysRaw) && refreshDaysRaw > 0 ? refreshDaysRaw : 14;
  const refreshExpiresAt = new Date(now.getTime() + refreshDays * 24 * 60 * 60 * 1000);

  await prisma.saSession.create({
    data: {
      tokenHash,
      refreshTokenHash,
      refreshExpiresAt,
      email: user.email,
      expiresAt,
      ip: args.ip || null,
      userAgent: args.userAgent || null
    }
  });

  return { token, refreshToken, expiresAt, refreshExpiresAt, email: user.email };
}

export async function getSaSessionByToken(token: string) {
  const t = normalizeSaToken(token);
  if (!t) return null;
  const tokenHash = sha256Hex(t);
  const s = await prisma.saSession.findUnique({ where: { tokenHash } });
  if (!s) return null;
  if (s.revokedAt) return null;
  if (s.expiresAt.getTime() <= Date.now()) return null;
  const user = await prisma.saUser.findFirst({
    where: { email: { equals: s.email, mode: "insensitive" }, role: SaUserRole.SUPER_ADMIN, active: true }
  });
  if (!user) return null;
  return { session: s, user };
}

export async function revokeSaSession(token: string) {
  const t = normalizeSaToken(token);
  if (!t) return;
  const tokenHash = sha256Hex(t);
  await prisma.saSession
    .update({
      where: { tokenHash },
      data: { revokedAt: new Date() }
    })
    .catch((err: any) => {
      logger.warn({ err }, "superadmin: fallo revocando sesión");
    });
}

export async function refreshSaSession(args: { refreshToken: string; ip?: string | null; userAgent?: string | null }) {
  const raw = String(args.refreshToken || "").trim();
  if (!raw) throw new Error("refresh_token_required");
  const refreshTokenHash = sha256Hex(raw);
  const session = await prisma.saSession.findUnique({ where: { refreshTokenHash } });
  if (!session || session.revokedAt) throw new Error("refresh_invalid");
  if (!session.refreshExpiresAt || session.refreshExpiresAt.getTime() <= Date.now()) throw new Error("refresh_expired");

  const user = await prisma.saUser.findFirst({
    where: { email: { equals: session.email, mode: "insensitive" }, role: SaUserRole.SUPER_ADMIN, active: true }
  });
  if (!user) throw new Error("unauthorized_sa");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const newRefreshToken = crypto.randomBytes(32).toString("hex");
  const newRefreshTokenHash = sha256Hex(newRefreshToken);
  const now = new Date();
  const ttlHoursRaw = Number(process.env.SA_SESSION_TTL_HOURS || "24");
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : 24;
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const refreshDaysRaw = Number(process.env.SA_REFRESH_TTL_DAYS || "14");
  const refreshDays = Number.isFinite(refreshDaysRaw) && refreshDaysRaw > 0 ? refreshDaysRaw : 14;
  const refreshExpiresAt = new Date(now.getTime() + refreshDays * 24 * 60 * 60 * 1000);

  await prisma.saSession
    .update({
      where: { id: session.id },
      data: {
        tokenHash,
        refreshTokenHash: newRefreshTokenHash,
        refreshExpiresAt,
        refreshRotatedAt: now,
        lastSeenAt: now,
        ...(args.ip ? { ip: args.ip } : {}),
        ...(args.userAgent ? { userAgent: args.userAgent } : {})
      }
    })
    .catch((err: any) => {
      logger.warn({ err, sessionId: session.id }, "superadmin: fallo actualizando sesión refrescada");
    });

  return { token, refreshToken: newRefreshToken, expiresAt, refreshExpiresAt, email: user.email };
}

export async function touchSaSession(token: string) {
  const t = normalizeSaToken(token);
  if (!t) return;
  const tokenHash = sha256Hex(t);
  const rollingEnabled = String(process.env.SA_SESSION_ROLLING || "1").trim() !== "0";
  const ttlHoursRaw = Number(process.env.SA_SESSION_TTL_HOURS || "24");
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : 24;
  const maxDaysRaw = Number(process.env.SA_SESSION_MAX_DAYS || "7");
  const maxDays = Number.isFinite(maxDaysRaw) && maxDaysRaw > 0 ? maxDaysRaw : 7;
  const now = new Date();

  if (!rollingEnabled) {
    await prisma.saSession
      .update({
        where: { tokenHash },
        data: { lastSeenAt: now }
      })
      .catch((err: any) => {
        logger.warn({ err }, "superadmin: fallo tocando sesión sin rolling");
      });
    return;
  }

  const session = await prisma.saSession.findUnique({ where: { tokenHash } }).catch((err: any) => {
    logger.warn({ err }, "superadmin: fallo cargando sesión para touch rolling");
    return null;
  });
  if (!session) return;

  const maxExpiry = new Date(session.createdAt.getTime() + maxDays * 24 * 60 * 60 * 1000);
  let nextExpires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  if (nextExpires.getTime() > maxExpiry.getTime()) {
    nextExpires = maxExpiry;
  }

  const shouldExtend =
    nextExpires.getTime() > session.expiresAt.getTime() &&
    nextExpires.getTime() - session.expiresAt.getTime() > 30 * 60 * 1000;

  await prisma.saSession
    .update({
      where: { tokenHash },
      data: { lastSeenAt: now, ...(shouldExtend ? { expiresAt: nextExpires } : {}) }
    })
    .catch((err: any) => {
      logger.warn({ err, shouldExtend }, "superadmin: fallo tocando sesión rolling");
    });
}

export async function requireSaSession(req: any, res: any, next: any) {
  const token = normalizeSaToken(req.header("x-sa-session") || req.header("authorization") || "");
  const out = await getSaSessionByToken(token);
  if (!out) return res.status(401).json({ error: "unauthorized_sa" });
  await touchSaSession(token).catch((err: any) => {
    logger.warn({ err, sessionId: out.session.id }, "superadmin: fallo tocando sesión en middleware");
  });
  (req as any).sa = { email: out.user.email, userId: out.user.id, role: out.user.role, sessionId: out.session.id };
  next();
}
