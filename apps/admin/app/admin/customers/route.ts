import { prisma } from "@suscripciones/database";
import { requireAdminToken } from "../_lib/requireAdminToken";
import { reqToCompat } from "../_lib/reqCompat";
import { getEffectiveTenantId, getEffectiveTenantIds } from "@suscripciones/core/services/tenantContext";
import { createCustomer, createCustomerSchema, listCustomers } from "../_services/customers";
import { logger } from "@suscripciones/core/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

 

export async function GET(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const compatReq = reqToCompat(req);
  const tenantId = await getEffectiveTenantId(compatReq);
  const takeRaw = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;
  const q = String(url.searchParams.get("q") ?? "").trim();
  const idsParam = url.searchParams.get("ids");
  const idsRaw = String(idsParam ?? "").trim();
  const ids = idsRaw ? idsRaw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  const idsEmpty = !idsRaw || idsRaw === "__none__" || ids.includes("__none__");
  if (idsParam !== null && (idsEmpty || ids.length === 0)) {
    return Response.json({ items: [], total: 0 });
  }
  const result = await listCustomers({ tenantId, take, skip, q, ids });
  return Response.json({ items: result.items, total: result.total });
}

export async function POST(req: Request) {
  const auth = await requireAdminToken(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    logger.error({
      error: parsed.error.flatten(),
      body
    }, "[Customers/Create] Validación fallida");
    return Response.json({ error: "cuerpo_invalido", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const compatReq = reqToCompat(req, body);
  const tenantIds = await getEffectiveTenantIds(compatReq);
  const result = await createCustomer({ data: parsed.data, tenantIds });
  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        mensaje: result.message,
        detalles: result.details,
        customerId: result.customerId
      },
      { status: result.status }
    );
  }

  return Response.json({ customer: result.customer }, { status: 201 });
}
