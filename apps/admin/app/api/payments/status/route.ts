import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getPaymentStatus } from "../../../admin/_services/payments";

export async function GET(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const paymentId = String(url.searchParams.get("paymentId") || "").trim();
  const tenantIdParam = String(url.searchParams.get("tenantId") || "").trim();
  if (!paymentId) return NextResponse.json({ ok: false, error: "missing_payment_id" }, { status: 400 });

  const tenantId = tenantIdParam || auth.session.tenantId || null;
  const result = await getPaymentStatus({ paymentId, tenantId });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, payment: result.payment, lastAttempt: result.lastAttempt });
}
