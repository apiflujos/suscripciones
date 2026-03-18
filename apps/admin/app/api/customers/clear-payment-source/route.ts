import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { clearCustomerPaymentSource } from "../../../admin/_services/customers";

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerId = String(body?.customerId || "").trim();
  const sourceId = Number(body?.sourceId || 0);
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const result = await clearCustomerPaymentSource({
    customerId,
    sourceId: Number.isFinite(sourceId) && sourceId > 0 ? sourceId : null
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, paymentSourceId: result.paymentSourceId, customer: result.customer });
}
