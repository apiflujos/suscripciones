import "server-only";

import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaUserRole } from "@prisma/client";
import { createSaSession, ensureBootstrapSuperAdmin, hashPassword, verifyPassword } from "@suscripciones/core/services/superAdminAuth";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";
import { logger } from "@suscripciones/core/lib/logger";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function loginAdminUser(input: unknown) {
  await ensureBootstrapSuperAdmin().catch((err: any) => {
    logger.warn({ err }, "Fallo asegurando bootstrap de superadmin en login");
  });
  const parsed = loginSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  const user = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user) {
    const total = await prisma.saUser.count();
    if (total === 0) return { ok: false as const, status: 500, error: "no_admin_users" as const };
    return { ok: false as const, status: 401, error: "unauthorized" as const };
  }
  if (!user.active) return { ok: false as const, status: 401, error: "unauthorized" as const };
  if (!verifyPassword(password, user.passwordHash)) return { ok: false as const, status: 401, error: "unauthorized" as const };

  if (user.role === SaUserRole.SUPER_ADMIN) {
    try {
      const session = await createSaSession({ email: user.email, password, ip: null, userAgent: null });
      const tenantId = user.tenantId ?? (await getDefaultTenantId());
      return {
        ok: true as const,
        kind: "super_admin",
        email: user.email,
        role: "SUPER_ADMIN",
        tenantId: tenantId ?? null,
        saToken: session.token,
        saRefreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString()
      };
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : "";
      if (msg === "no_super_admin_user") return { ok: false as const, status: 500, error: "no_super_admin_user" as const };
      return { ok: false as const, status: 401, error: "unauthorized" as const };
    }
  }

  const role = user.role === SaUserRole.ADMIN ? "ADMIN" : "AGENT";
  return { ok: true as const, kind: "user", email: user.email, role, tenantId: user.tenantId ?? null };
}

export async function bootstrapSuperAdmin(input: unknown) {
  const parsed = bootstrapSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };

  const existingSuperAdmins = await prisma.saUser.count({ where: { role: SaUserRole.SUPER_ADMIN, active: true } });
  if (existingSuperAdmins > 0) return { ok: false as const, status: 409, error: "already_bootstrapped" as const };

  const tenantId = await getDefaultTenantId();
  if (!tenantId) return { ok: false as const, status: 500, error: "tenant_not_ready" as const };

  const email = parsed.data.email.trim().toLowerCase();
  const existingEmail = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (existingEmail) return { ok: false as const, status: 409, error: "email_already_exists" as const };

  await prisma.saUser.create({
    data: {
      tenantId,
      email,
      passwordHash: hashPassword(parsed.data.password),
      role: SaUserRole.SUPER_ADMIN,
      active: true
    } as any
  });

  const session = await createSaSession({ email, password: parsed.data.password, ip: null, userAgent: null });
  return {
    ok: true as const,
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt.toISOString(),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    email: session.email
  };
}
