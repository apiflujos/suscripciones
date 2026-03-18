import { z } from "zod";
import { requireAdminToken } from "../../_lib/requireAdminToken";
import { refreshSaSession } from "@suscripciones/core/services/superAdminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refreshSchema = z.object({
  refreshToken: z.string().min(10)
});

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const ip = String(req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent") || null;
    const session = await refreshSaSession({
      refreshToken: parsed.data.refreshToken,
      ip,
      userAgent: ua
    });
    return Response.json({
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      email: session.email
    });
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "";
    if (msg === "refresh_token_required") return Response.json({ error: "refresh_token_required" }, { status: 400 });
    if (msg === "refresh_expired") return Response.json({ error: "refresh_expired" }, { status: 401 });
    return Response.json({ error: "refresh_invalid" }, { status: 401 });
  }
}
