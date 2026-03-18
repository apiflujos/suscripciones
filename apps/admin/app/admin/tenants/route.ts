import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../_lib/requireAdminToken";
import { listTenants } from "../_services/tenants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gamificationSchema = z
  .object({
    factor: z.number().optional(),
    bonus: z.number().optional(),
    followupMinutes: z.number().int().positive().optional(),
    followupCooldownMinutes: z.number().int().positive().optional(),
    followupMaxAttempts: z.number().int().positive().optional()
  })
  .optional();

const createTenantSchema = z.object({
  name: z.string().min(1),
  logoUrl: z.string().trim().optional().nullable(),
  gamification: gamificationSchema
});

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const items = await listTenants();
  return Response.json({ items });
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createTenantSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.name.trim();
  const logoUrl = String(parsed.data.logoUrl || "").trim();
  const gamification = parsed.data.gamification;
  const existing = await prisma.saTenant.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return Response.json({ tenant: existing, created: false });

  const meta: any = {};
  if (logoUrl) meta.logoUrl = logoUrl;
  if (gamification) {
    meta.gamification = {
      ...(typeof gamification.factor === "number" ? { factor: gamification.factor } : {}),
      ...(typeof gamification.bonus === "number" ? { bonus: gamification.bonus } : {}),
      ...(typeof gamification.followupMinutes === "number" ? { followupMinutes: gamification.followupMinutes } : {}),
      ...(typeof gamification.followupCooldownMinutes === "number"
        ? { followupCooldownMinutes: gamification.followupCooldownMinutes }
        : {}),
      ...(typeof gamification.followupMaxAttempts === "number" ? { followupMaxAttempts: gamification.followupMaxAttempts } : {})
    };
  }

  const tenant = await prisma.saTenant.create({
    data: {
      name,
      active: true,
      ...(Object.keys(meta).length ? { metadata: meta } : {})
    }
  });
  const superAdmins = await prisma.saUser.findMany({ where: { role: "SUPER_ADMIN", active: true }, select: { id: true } });
  if (superAdmins.length) {
    await prisma.saUserTenant.createMany({
      data: superAdmins.map((u: any) => ({ userId: u.id, tenantId: tenant.id })),
      skipDuplicates: true
    });
  }
  return Response.json({ tenant, created: true }, { status: 201 });
}
