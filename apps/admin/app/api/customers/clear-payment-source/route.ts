import { NextResponse } from "next/server";
import { normalizeToken } from "../../../lib/normalizeToken";
import { getRequiredApiBase } from "../../../lib/adminApi";

export async function POST(req: Request) {
  const API_BASE = getRequiredApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return NextResponse.json({ ok: false, error: "missing_admin_token" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerId = String(body?.customerId || "").trim();
  const sourceId = Number(body?.sourceId || 0);
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const res = await fetch(`${API_BASE}/admin/customers/${customerId}/wompi/payment-source/clear`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify(Number.isFinite(sourceId) && sourceId > 0 ? { sourceId } : {})
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: json?.error || "request_failed" }, { status: res.status });
  }

  return NextResponse.json({ ok: true, paymentSourceId: json?.paymentSourceId ?? null, customer: json?.customer ?? null });
}
