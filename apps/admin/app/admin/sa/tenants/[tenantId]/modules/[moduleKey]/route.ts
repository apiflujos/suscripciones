import { z } from "zod";
import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../../../../../_lib/requireAdminToken";
import { requireSaSession } from "../../../../../_lib/requireSaSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tenantModuleToggleSchema = z.object({
  enabled: z.boolean()
});

export async function PUT(req: Request, ctx: { params: Promise<{ tenantId: string; moduleKey: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const sa = await requireSaSession(req);
  if (!sa.ok) return sa.response;

  const tenantId = String(params?.tenantId || "");
  const moduleKey = String(params?.moduleKey || "");
  const body = await req.json().catch(() => null);
  const parsed = tenantModuleToggleSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const t = await prisma.saTenant.findUnique({ where: { id: tenantId } });
  if (!t) return Response.json({ error: "tenant_not_found" }, { status: 404 });

  const def = await prisma.saModuleDefinition.findUnique({ where: { key: moduleKey } });
  if (!def) return Response.json({ error: "module_not_found" }, { status: 404 });

  const toggle = await prisma.saTenantModuleToggle.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
    create: { tenantId, moduleKey, enabled: parsed.data.enabled } as any,
    update: { enabled: parsed.data.enabled } as any
  });

  return Response.json({ toggle });
}
