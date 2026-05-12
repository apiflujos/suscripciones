import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { getActorFromReq } from "@suscripciones/core/services/actorContext";
import { scheduleTokenizationLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const customerId = String(body?.customerId || "").trim();
  const tokenUrl = String(body?.tokenUrl || "").trim();
  const tenantId = String(body?.tenantId || "").trim();
  const planId = String(body?.planId || "").trim();
  const productId = String(body?.productId || "").trim();
  if (!customerId || !tokenUrl) return Response.json({ error: "invalid_payload" }, { status: 400 });

  const url = new URL(req.url);
  const forceNow = String(url.searchParams.get("forceNow") ?? "").trim() === "1";
  const compatReq = reqToCompat(req, body);
  const actor = getActorFromReq(compatReq as any);
  const result = await scheduleTokenizationLinkNotifications({
    customerId,
    tokenUrl,
    tenantId: tenantId || null,
    planId: planId || null,
    productId: productId || null,
    forceNow,
    actor
  });
  return Response.json({ ok: true, ...result });
}
