import { requireAdminToken } from "../../../_lib/requireAdminToken";
import { reqToCompat } from "../../../_lib/reqCompat";
import { getActorFromReq } from "@suscripciones/core/services/actorContext";
import { scheduleCatalogLinkNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { agendarCatalogoSchema } from "@suscripciones/core/services/publicLinkSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  // Mismo motivo que en tokenización: este enlace lo recibe el cliente por
  // WhatsApp, así que tiene que ser del dominio público de la aplicación.
  const parsed = agendarCatalogoSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_payload", detalles: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 }
    );
  }
  const { customerId, catalogUrl } = parsed.data;
  const catalogTypeRaw = String((body as any)?.catalogType || "").trim().toUpperCase();
  const catalogType = catalogTypeRaw === "SUBSCRIPTION" ? "SUBSCRIPTION" : catalogTypeRaw === "PLAN" ? "PLAN" : "";

  const url = new URL(req.url);
  const forceNow = String(url.searchParams.get("forceNow") ?? "").trim() === "1";
  const compatReq = reqToCompat(req, body);
  const actor = getActorFromReq(compatReq as any);
  const result = await scheduleCatalogLinkNotifications({ customerId, catalogUrl, forceNow, paymentType: catalogType, actor });
  return Response.json({ ok: true, ...result });
}
