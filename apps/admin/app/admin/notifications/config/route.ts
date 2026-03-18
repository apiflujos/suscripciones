import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import {
  getNotificationsConfig,
  getNotificationsConfigForEnv,
  notificationsConfigSchema,
  setNotificationsConfig
} from "@suscripciones/core/services/notificationsConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const putConfigSchema = z.object({
  environment: z.enum(["PRODUCTION", "SANDBOX"]).optional(),
  config: z.unknown()
});

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const envRaw = String(url.searchParams.get("environment") ?? "").trim().toUpperCase();
  const env = envRaw === "SANDBOX" ? "SANDBOX" : envRaw === "PRODUCTION" ? "PRODUCTION" : null;
  const config = env ? await getNotificationsConfigForEnv(env) : await getNotificationsConfig();
  return Response.json({ config });
}

export async function PUT(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = putConfigSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  try {
    const env = parsed.data.environment;
    const normalized = notificationsConfigSchema.parse(parsed.data.config);
    const saved = await setNotificationsConfig(normalized, { environment: env });
    return Response.json({ ok: true, config: saved });
  } catch (err: any) {
    return Response.json({ error: "invalid_config", message: String(err?.message || err) }, { status: 400 });
  }
}
