import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { reqToCompat } from "../../../admin/_lib/reqCompat";
import { getEffectiveTenantIds } from "@suscripciones/core/services/tenantContext";
import { createCustomer, createCustomerSchema } from "../../../admin/_services/customers";

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "cuerpo_invalido", detalles: parsed.error.flatten() }, { status: 400 });
  }

  const compatReq = reqToCompat(req, body);
  const tenantIds = await getEffectiveTenantIds(compatReq);
  const result = await createCustomer({ data: parsed.data, tenantIds });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        mensaje: result.message,
        detalles: result.details,
        customerId: result.customerId
      },
      { status: result.status }
    );
  }
  return NextResponse.json({ ok: true, customerId: result.customer.id });
}
