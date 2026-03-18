import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { getActorFromReq } from "@suscripciones/core/services/actorContext";
import { scheduleCatalogLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const customerId = String(body?.customerId || "").trim();
  const catalogUrl = String(body?.catalogUrl || "").trim();
  const catalogTypeRaw = String(body?.catalogType || "").trim().toUpperCase();
  const catalogType = catalogTypeRaw === "SUBSCRIPTION" ? "SUBSCRIPTION" : catalogTypeRaw === "PLAN" ? "PLAN" : "";
  if (!customerId || !catalogUrl) return Response.json({ error: "invalid_payload" }, { status: 400 });

  const url = new URL(req.url);
  const forceNow = String(url.searchParams.get("forceNow") ?? "").trim() === "1";
  const compatReq = reqToCompat(req, body);
  const actor = getActorFromReq(compatReq as any);
  const result = await scheduleCatalogLinkNotifications({ customerId, catalogUrl, forceNow, paymentType: catalogType, actor });
  return Response.json({ ok: true, ...result });
}
