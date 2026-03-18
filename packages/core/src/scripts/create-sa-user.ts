import { prisma } from "../db/prisma";
import { hashPassword } from "../services/superAdminAuth";
import { SaUserRole } from "@prisma/client";

function normalizeEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

function parseRole(v: string | undefined): SaUserRole {
  const raw = String(v || "").trim().toUpperCase();
  if (raw === "ADMIN") return SaUserRole.ADMIN;
  if (raw === "AGENT") return SaUserRole.AGENT;
  return SaUserRole.SUPER_ADMIN;
}

async function main() {
  const email = normalizeEmail(process.env.SA_EMAIL || "");
  const password = String(process.env.SA_PASSWORD || "");
  const role = parseRole(process.env.SA_ROLE);
  const active = (process.env.SA_ACTIVE || "true").trim().toLowerCase() !== "false";
  const tenantId = String(process.env.SA_TENANT_ID || "").trim() || null;
  const resetPassword = (process.env.SA_RESET_PASSWORD || "").trim() === "1";
  const ensureSuperAdmin = (process.env.SA_ENSURE_SUPER_ADMIN || "1").trim() !== "0";

  if (!email) throw new Error("SA_EMAIL is required");
  if (!password && resetPassword) throw new Error("SA_PASSWORD is required when SA_RESET_PASSWORD=1");

  const existing = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

  if (existing) {
    const nextRole = ensureSuperAdmin ? SaUserRole.SUPER_ADMIN : role;
    const updates: any = {};
    if (existing.role !== nextRole) updates.role = nextRole;
    if (existing.active !== active) updates.active = active;
    if (resetPassword) updates.passwordHash = hashPassword(password);

    if (Object.keys(updates).length > 0) {
      await prisma.saUser.update({ where: { id: existing.id }, data: updates });
      console.log("UPDATED", { email, role: updates.role ?? existing.role, active: updates.active ?? existing.active });
    } else {
      console.log("NOOP", { email, role: existing.role, active: existing.active });
    }
    return;
  }

  if (!password) throw new Error("SA_PASSWORD is required for new users");

  await prisma.saUser.create({
    data: {
      tenantId,
      email,
      passwordHash: hashPassword(password),
      role,
      active
    } as any
  });
  console.log("CREATED", { email, role, active });
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
