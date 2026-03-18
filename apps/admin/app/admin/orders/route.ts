import { requireAdminToken } from "../_lib/requireAdminToken";
import { reqToCompat } from "../_lib/reqCompat";
import { getEffectiveTenantId } from "@suscripciones/core/services/tenantContext";
import { createManualOrder, listManualOrders } from "../_services/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq as any);
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const q = String(url.searchParams.get("q") ?? "").trim();
  const idsParam = url.searchParams.get("ids");
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (idsParam !== null && (idsEmpty || ids.length === 0)) {
    return Response.json({ items: [] });
  }
  const result = await listManualOrders({ tenantId, take, q, ids });
  return Response.json({ items: result.items });
}

export async function POST(req: Request) {
  const auth = requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const result = await createManualOrder({ req, body });
  if (!result.ok) return Response.json({ error: result.error, details: result.details }, { status: result.status });
  return Response.json(
    {
      payment: result.payment,
      checkoutUrl: result.checkoutUrl,
      notificationsScheduled: result.notificationsScheduled,
      notificationsSent: result.notificationsSent,
      notificationsRulesActive: result.notificationsRulesActive
    },
    { status: result.status }
  );
}
