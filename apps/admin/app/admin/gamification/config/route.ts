import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { getGamificationConfig, updateGamificationConfig } from "../../_services/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateConfigSchema = z.object({
  config: z.any()
});

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const cfg = await getGamificationConfig();
  return Response.json(cfg);
}

export async function PUT(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = updateConfigSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const saved = await updateGamificationConfig(parsed.data.config);
  return Response.json(saved);
}
