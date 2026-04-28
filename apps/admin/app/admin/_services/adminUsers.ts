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
  if (!tenantId && requester.role !== "SUPER_ADMIN") {
    return { ok: false as const, status: 400, error: "no_tenant_context" as const };
  }

  const items = await prisma.saUser.findMany({
    where:
      requester.role === "SUPER_ADMIN"
        ? {}
        : {
            OR: [
              { tenantId },
              {
                tenants: {
                  some: { tenantId: tenantId || undefined }
                }
              }
            ]
          },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      tenantId: true,
      tenants: { select: { tenantId: true, tenant: { select: { id: true, name: true } } } }
    }
  });

  const normalized = items.map((u: any) => {
    const tenantIds = Array.from(
      new Set([u.tenantId, ...(u.tenants || []).map((t: any) => t?.tenantId)].filter(Boolean))
    );
    const tenantNames = Array.from(
      new Set(
        (u.tenants || [])
          .map((t: any) => t?.tenant?.name)
          .filter((n: any) => typeof n === "string" && n.trim())
      )
    );
    return { ...u, tenantIds, tenantNames };
  });

  return { ok: true as const, items: normalized };
}

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([SaUserRole.ADMIN, SaUserRole.AGENT]),
  active: z.boolean().optional().default(true),
  tenantIds: z.array(z.string().uuid()).optional()
});

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum([SaUserRole.SUPER_ADMIN, SaUserRole.ADMIN, SaUserRole.AGENT]),
  active: z.boolean().optional().default(true),
  tenantIds: z.array(z.string().uuid()).optional()
});

const changePasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8)
});

const deleteUserSchema = z.object({
  userId: z.string().uuid()
});

function normalizeTenantIds(tenantIds: string[] | undefined, requester: AdminUserRequester | null) {
  const requesterTenantId = requester?.tenantId || null;
  if (requester?.role === "SUPER_ADMIN") {
    return Array.from(new Set((tenantIds || []).map((t) => String(t).trim()).filter(Boolean)));
  }
  return requesterTenantId ? [requesterTenantId] : [];
}

function canAccessUser(requester: AdminUserRequester, user: { tenantId?: string | null; tenants?: Array<{ tenantId?: string | null }> }) {
  if (requester.role === "SUPER_ADMIN") return true;
  const tenantId = requester.tenantId || null;
  if (!tenantId) return false;
  if (user.tenantId && user.tenantId === tenantId) return true;
  return Boolean((user.tenants || []).some((item) => item?.tenantId === tenantId));
}

async function ensureUserCanBeManaged(requester: AdminUserRequester | null, userId: string) {
  if (!requester || !canManageUsers(requester.role)) {
    return { ok: false as const, status: 403, error: "unauthorized_role" as const };
  }

  const user = await prisma.saUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      tenantId: true,
      tenants: { select: { tenantId: true } }
    }
  });

  if (!user) return { ok: false as const, status: 404, error: "user_not_found" as const };
  if (!canAccessUser(requester, user)) {
    return { ok: false as const, status: 403, error: "user_outside_scope" as const };
  }
  if (user.role === SaUserRole.SUPER_ADMIN && requester.role !== "SUPER_ADMIN") {
    return { ok: false as const, status: 403, error: "cannot_manage_super_admin" as const };
  }

  return { ok: true as const, user };
}

async function ensureNotLastSuperAdmin(userId: string) {
  const count = await prisma.saUser.count({
    where: { role: SaUserRole.SUPER_ADMIN, active: true, id: { not: userId } }
  });
  return count > 0;
}

export async function createAdminUser(requester: AdminUserRequester | null, input: unknown) {
  if (!requester || !canManageUsers(requester.role)) {
    return { ok: false as const, status: 403, error: "unauthorized_role" as const };
  }
  const parsed = createUserSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  }

  const requesterTenantId = requester.tenantId || null;
  if (!requesterTenantId && requester.role !== "SUPER_ADMIN") {
    return { ok: false as const, status: 400, error: "no_tenant_context" as const };
  }

  const inputTenantIds = Array.isArray(parsed.data.tenantIds) ? parsed.data.tenantIds : [];
  const tenantIds = normalizeTenantIds(inputTenantIds, requester);
  if (!tenantIds.length) {
    return { ok: false as const, status: 400, error: "tenant_required" as const };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.saUser.findUnique({ where: { email } });
  if (existing) return { ok: false as const, status: 409, error: "email_already_exists" as const };

  const user = await prisma.saUser.create({
    data: {
      tenantId: tenantIds[0],
      email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      active: parsed.data.active
    } as any
  });

  await prisma.saUserTenant.createMany({
    data: tenantIds.map((tenantId) => ({ userId: user.id, tenantId })),
    skipDuplicates: true
  });

  return {
    ok: true as const,
    user: { id: user.id, email: user.email, role: user.role, active: user.active, tenantIds }
  };
}

export async function updateAdminUser(requester: AdminUserRequester | null, input: unknown) {
  if (!requester || !canManageUsers(requester.role)) {
    return { ok: false as const, status: 403, error: "unauthorized_role" as const };
  }

  const parsed = updateUserSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  }

  const scoped = await ensureUserCanBeManaged(requester, parsed.data.userId);
  if (!scoped.ok) return scoped;

  const existing = scoped.user;
  const isSelf = existing.email.toLowerCase() === requester.email.toLowerCase();
  const nextRole = parsed.data.role;
  const tenantIds = normalizeTenantIds(parsed.data.tenantIds, requester);

  if (!tenantIds.length) {
    return { ok: false as const, status: 400, error: "tenant_required" as const };
  }
  if (nextRole === SaUserRole.SUPER_ADMIN && requester.role !== "SUPER_ADMIN") {
    return { ok: false as const, status: 403, error: "cannot_assign_super_admin" as const };
  }
  if (isSelf && (parsed.data.active === false || nextRole !== existing.role)) {
    return { ok: false as const, status: 400, error: "cannot_change_own_access" as const };
  }
  if (existing.role === SaUserRole.SUPER_ADMIN && (parsed.data.active === false || nextRole !== SaUserRole.SUPER_ADMIN)) {
    const hasOtherSuperAdmin = await ensureNotLastSuperAdmin(existing.id);
    if (!hasOtherSuperAdmin) {
      return { ok: false as const, status: 400, error: "last_super_admin_protected" as const };
    }
  }

  const email = parsed.data.email.trim().toLowerCase();
  const emailOwner = await prisma.saUser.findUnique({ where: { email } });
  if (emailOwner && emailOwner.id !== existing.id) {
    return { ok: false as const, status: 409, error: "email_already_exists" as const };
  }

  const user = await prisma.saUser.update({
    where: { id: existing.id },
    data: {
      email,
      role: nextRole,
      active: parsed.data.active,
      tenantId: tenantIds[0]
    }
  });

  await prisma.saUserTenant.deleteMany({ where: { userId: existing.id } });
  await prisma.saUserTenant.createMany({
    data: tenantIds.map((tenantId) => ({ userId: existing.id, tenantId })),
    skipDuplicates: true
  });

  return {
    ok: true as const,
    user: { id: user.id, email: user.email, role: user.role, active: user.active, tenantIds }
  };
}

export async function updateAdminUserPassword(requester: AdminUserRequester | null, input: unknown) {
  if (!requester || !canManageUsers(requester.role)) {
    return { ok: false as const, status: 403, error: "unauthorized_role" as const };
  }

  const parsed = changePasswordSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  }

  const scoped = await ensureUserCanBeManaged(requester, parsed.data.userId);
  if (!scoped.ok) return scoped;

  await prisma.saUser.update({
    where: { id: scoped.user.id },
    data: { passwordHash: hashPassword(parsed.data.password) }
  });

  return { ok: true as const };
}

export async function deleteAdminUser(requester: AdminUserRequester | null, input: unknown) {
  if (!requester || !canManageUsers(requester.role)) {
    return { ok: false as const, status: 403, error: "unauthorized_role" as const };
  }

  const parsed = deleteUserSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false as const, status: 400, error: "invalid_body" as const, details: parsed.error.flatten() };
  }

  const scoped = await ensureUserCanBeManaged(requester, parsed.data.userId);
  if (!scoped.ok) return scoped;

  const existing = scoped.user;
  if (existing.email.toLowerCase() === requester.email.toLowerCase()) {
    return { ok: false as const, status: 400, error: "cannot_delete_own_user" as const };
  }
  if (existing.role === SaUserRole.SUPER_ADMIN) {
    const hasOtherSuperAdmin = await ensureNotLastSuperAdmin(existing.id);
    if (!hasOtherSuperAdmin) {
      return { ok: false as const, status: 400, error: "last_super_admin_protected" as const };
    }
  }

  await prisma.saUser.delete({ where: { id: existing.id } });
  return { ok: true as const };
}
