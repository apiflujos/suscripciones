import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { SaUserRole } from "@prisma/client";
import { prisma } from "../db/prisma";
import { sha256Hex, timingSafeEqualHex } from "../lib/crypto";

function normalize(v: unknown) {
  return String(v || "").trim();
}

export const SUPER_ADMIN_EMAIL = normalize(process.env.SUPER_ADMIN_EMAIL);

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
  const hasAnySuperAdmin = await prisma.saUser.count({ where: { role: SaUserRole.SUPER_ADMIN, active: true } });
  if (!hasAnySuperAdmin) throw new Error("no_super_admin_user");

  const email = String(args.email || "").trim().toLowerCase();
  const user = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user || !user.active || user.role !== SaUserRole.SUPER_ADMIN) throw new Error("unauthorized_sa");
  if (!verifyPassword(args.password, user.passwordHash)) throw new Error("unauthorized_sa");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await prisma.saSession.create({
    data: {
      tokenHash,
      email: user.email,
      expiresAt,
      ip: args.ip || null,
      userAgent: args.userAgent || null
    }
  });

  return { token, expiresAt, email: user.email };
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
  const out = await getSaSessionByToken(token);
  if (!out) return res.status(401).json({ error: "unauthorized_sa" });
  await touchSaSession(token).catch(() => {});
  (req as any).sa = { email: out.user.email, userId: out.user.id, role: out.user.role, sessionId: out.session.id };
  next();
}
