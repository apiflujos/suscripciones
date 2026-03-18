import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../../_lib/reqCompat";
import { getActorFromReq } from "@suscripciones/core/services/actorContext";
import { schedulePaymentStatusNotifications } from "@suscripciones/core/services/notificationsScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const paymentId = String(params?.id || "").trim();
  if (!paymentId) return Response.json({ error: "invalid_payment_id" }, { status: 400 });

  const url = new URL(req.url);
  const forceNow = String(url.searchParams.get("forceNow") ?? "").trim() === "1";
  const compatReq = reqToCompat(req);
  const actor = getActorFromReq(compatReq as any);
  const result = await schedulePaymentStatusNotifications({ paymentId, forceNow, actor });
  return Response.json({ ok: true, ...result });
}
