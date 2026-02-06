import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../db/prisma";
import { sha256Hex, timingSafeEqualHex } from "../lib/crypto";

export const SUPER_ADMIN_EMAIL = "comercial@apiflujos.com";
export const SUPER_ADMIN_PASSWORD = "apiflujos2026*";

const SUPER_ADMIN_PASSWORD_HASH = sha256Hex(SUPER_ADMIN_PASSWORD);

export function isSuperAdminEmail(email: string) {
  return String(email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

export function verifySuperAdminPassword(pw: string) {
  const got = sha256Hex(String(pw || ""));
  return timingSafeEqualHex(got, SUPER_ADMIN_PASSWORD_HASH);
}

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

export function normalizeSaToken(v: unknown) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  if (raw.startsWith("Bearer ")) return raw.slice("Bearer ".length).trim();
  return raw;
}

export async function createSaSession(args: { email: string; password: string; ip?: string | null; userAgent?: string | null }) {
  if (!isSuperAdminEmail(args.email)) throw new Error("invalid_super_admin");
  if (!verifySuperAdminPassword(args.password)) throw new Error("invalid_super_admin");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await prisma.saSession.create({
    data: {
      tokenHash,
      email: SUPER_ADMIN_EMAIL,
      expiresAt,
      ip: args.ip || null,
      userAgent: args.userAgent || null
    }
  });

  return { token, expiresAt };
}

export async function getSaSessionByToken(token: string) {
  const t = normalizeSaToken(token);
  if (!t) return null;
  const tokenHash = sha256Hex(t);
  const s = await prisma.saSession.findUnique({ where: { tokenHash } });
  if (!s) return null;
  if (s.revokedAt) return null;
  if (s.expiresAt.getTime() <= Date.now()) return null;
  if (!isSuperAdminEmail(s.email)) return null;
  return s;
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
    .catch(() => {});
}

export async function touchSaSession(token: string) {
  const t = normalizeSaToken(token);
  if (!t) return;
  const tokenHash = sha256Hex(t);
  await prisma.saSession
    .update({
      where: { tokenHash },
      data: { lastSeenAt: new Date() }
    })
    .catch(() => {});
}

export async function requireSaSession(req: Request, res: Response, next: NextFunction) {
  const token = normalizeSaToken(req.header("x-sa-session") || req.header("authorization") || "");
  const s = await getSaSessionByToken(token);
  if (!s) return res.status(401).json({ error: "unauthorized_sa" });
  await touchSaSession(token).catch(() => {});
  (req as any).sa = { email: s.email, sessionId: s.id };
  next();
}
