import "server-only";

import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaUserRole } from "@prisma/client";
import { hashPassword } from "@suscripciones/core/services/superAdminAuth";

export type AdminUserRequester = {
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "AGENT";
  tenantId?: string | null;
};

function canManageUsers(role: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export async function listAdminUsers(requester: AdminUserRequester | null) {
  if (!requester || !canManageUsers(requester.role)) {
    return { ok: false as const, status: 403, error: "unauthorized_role" as const };
  }
  const tenantId = requester.tenantId || null;
  if (!tenantId) return { ok: false as const, status: 400, error: "no_tenant_context" as const };

  const items = await prisma.saUser.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, active: true, createdAt: true }
  });

  return { ok: true as const, items };
}

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([SaUserRole.ADMIN, SaUserRole.AGENT]),
  active: z.boolean().optional().default(true)
});

export async function createAdminUser(requester: AdminUserRequester | null, input: unknown) {
  if (!requester || !canManageUsers(requester.role)) {
    return { ok: false as const, status: 403, error: "unauthorized_role" as const };
  }
  const tenantId = requester.tenantId || null;
  if (!tenantId) return { ok: false as const, status: 400, error: "no_tenant_context" as const };

  const parsed = createUserSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.saUser.findUnique({ where: { email } });
  if (existing) return { ok: false as const, status: 409, error: "email_already_exists" as const };

  const user = await prisma.saUser.create({
    data: {
      tenantId,
      email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      active: parsed.data.active
    } as any
  });

  return { ok: true as const, user: { id: user.id, email: user.email, role: user.role, active: user.active } };
}
