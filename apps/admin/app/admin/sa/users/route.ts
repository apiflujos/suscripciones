import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaUserRole } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";
import { hashPassword } from "@suscripciones/core/services/superAdminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  tenantIds: z.array(z.string().uuid()).min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([SaUserRole.ADMIN, SaUserRole.AGENT]),
  active: z.boolean().optional()
});

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const items = await prisma.saUser.findMany({
    orderBy: { createdAt: "desc" },
    include: { tenants: true }
  });

  return Response.json({
    items: items.map((u: any) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      active: u.active,
      tenantId: u.tenantId,
      tenantIds: Array.from(new Set([u.tenantId, ...(u.tenants || []).map((t: any) => t.tenantId)].filter(Boolean)))
    }))
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const tenantIds = Array.from(new Set(parsed.data.tenantIds.map((id) => String(id).trim()).filter(Boolean)));
  const tenants = await prisma.saTenant.findMany({ where: { id: { in: tenantIds } } });
  if (tenants.length !== tenantIds.length) return Response.json({ error: "tenant_not_found" }, { status: 404 });

  const user = await prisma.saUser.create({
    data: {
      tenantId: tenantIds[0],
      email: parsed.data.email.trim().toLowerCase(),
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      active: parsed.data.active ?? true
    } as any
  });

  await prisma.saUserTenant.createMany({
    data: tenantIds.map((tenantId) => ({ userId: user.id, tenantId })),
    skipDuplicates: true
  });

  return Response.json({ user: { ...user, tenantIds } }, { status: 201 });
}
