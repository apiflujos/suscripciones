import { NextResponse } from "next/server";
import { normalizeToken } from "../../../lib/normalizeToken";
import { getRequiredApiBase } from "../../../lib/adminApi";

export async function GET(req: Request) {
  const API_BASE = getRequiredApiBase();
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return NextResponse.json({ ok: false, error: "missing_admin_token" }, { status: 401 });

  const url = new URL(req.url);
  const paymentId = String(url.searchParams.get("paymentId") || "").trim();
  const tenantId = String(url.searchParams.get("tenantId") || "").trim();
  if (!paymentId) return NextResponse.json({ ok: false, error: "missing_payment_id" }, { status: 400 });

  const path = tenantId
    ? `/admin/payments/${encodeURIComponent(paymentId)}?tenantId=${encodeURIComponent(tenantId)}`
    : `/admin/payments/${encodeURIComponent(paymentId)}`;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: json?.error || "request_failed" }, { status: res.status });
  }
  return NextResponse.json({ ok: true, ...json });
}
