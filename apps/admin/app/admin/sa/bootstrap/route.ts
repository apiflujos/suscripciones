import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { SaUserRole } from "@prisma/client";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { createSaSession, hashPassword } from "@suscripciones/core/services/superAdminAuth";
import { getDefaultTenantId } from "@suscripciones/core/services/tenantContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = bootstrapSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const existingSuperAdmins = await prisma.saUser.count({ where: { role: SaUserRole.SUPER_ADMIN, active: true } });
  if (existingSuperAdmins > 0) {
    return Response.json({ error: "already_bootstrapped" }, { status: 409 });
  }

  const tenantId = await getDefaultTenantId();
  if (!tenantId) return Response.json({ error: "tenant_not_ready" }, { status: 500 });

  const email = parsed.data.email.trim().toLowerCase();
  const existingEmail = await prisma.saUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (existingEmail) return Response.json({ error: "email_already_exists" }, { status: 409 });

  await prisma.saUser.create({
    data: {
      tenantId,
      email,
      passwordHash: hashPassword(parsed.data.password),
      role: SaUserRole.SUPER_ADMIN,
      active: true
    } as any
  });

  const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  const session = await createSaSession({ email, password: parsed.data.password, ip, userAgent: ua });

  return Response.json(
    {
      ok: true,
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      email: session.email
    },
    { status: 201 }
  );
}
