import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaUserRole } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { requireSaSession } from "../../_lib/requireSaSession";
import { hashPassword } from "@suscripciones/core/services/superAdminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([SaUserRole.ADMIN, SaUserRole.AGENT]),
  active: z.boolean().optional()
});

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
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
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const t = await prisma.saTenant.findUnique({ where: { id: parsed.data.tenantId } });
  if (!t) return Response.json({ error: "tenant_not_found" }, { status: 404 });

  const user = await prisma.saUser.create({
    data: {
      tenantId: parsed.data.tenantId,
      email: parsed.data.email.trim().toLowerCase(),
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      active: parsed.data.active ?? true
    } as any
  });

  return Response.json({ user }, { status: 201 });
}
