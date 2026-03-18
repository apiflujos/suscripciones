import { requireAdminToken } from "../../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../../_lib/reqCompat";
import { getActorFromReq } from "@suscripciones/core/services/actorContext";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const subscriptionId = String(params?.id || "").trim();
  if (!subscriptionId) return Response.json({ error: "invalid_subscription_id" }, { status: 400 });

  const url = new URL(req.url);
  const forceNow = String(url.searchParams.get("forceNow") ?? "").trim() === "1";
  const compatReq = reqToCompat(req);
  const actor = getActorFromReq(compatReq as any);
  const result = await scheduleSubscriptionDueNotifications({ subscriptionId, forceNow, actor });
  return Response.json({ ok: true, ...result });
}
