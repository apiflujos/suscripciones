import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { getActorFromReq } from "@suscripciones/core/services/actorContext";
import { scheduleTokenizationLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { agendarTokenizacionSchema } from "@suscripciones/core/services/publicLinkSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  // El enlace acaba en una plantilla de WhatsApp que ve el cliente: se exige que
  // sea del dominio público de la aplicación, no cualquier URL que quepa en el
  // cuerpo de la petición.
  const parsed = agendarTokenizacionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_payload", detalles: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 }
    );
  }
  const { customerId, tokenUrl, tenantId, planId, productId } = parsed.data;

  const url = new URL(req.url);
  const forceNow = String(url.searchParams.get("forceNow") ?? "").trim() === "1";
  const compatReq = reqToCompat(req, body);
  const actor = getActorFromReq(compatReq as any);
  const result = await scheduleTokenizationLinkNotifications({
    customerId,
    tokenUrl,
    tenantId,
    planId,
    productId,
    forceNow,
    actor
  });
  return Response.json({ ok: true, ...result });
}
