import { NextResponse } from "next/server";
import { normalizeToken } from "../../../lib/normalizeToken";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

function pesosToCents(input: string): number {
  const digits = String(input || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
}

export async function POST(req: Request) {
  const token = normalizeToken(process.env.ADMIN_API_TOKEN || "");
  if (!token) return NextResponse.json({ ok: false, error: "missing_admin_token" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerId = String(body?.customerId || "").trim();
  const customerName = String(body?.customerName || "").trim() || "Cliente";
  const amountInCents = pesosToCents(String(body?.amount || ""));
  if (!customerId || amountInCents <= 0) {
    return NextResponse.json({ ok: false, error: "monto_invalido" }, { status: 400 });
  }

  const reference = `CONTACT_${customerId.slice(0, 6)}_${Date.now()}`;

  const res = await fetch(`${API_BASE}/admin/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      customerId,
      reference,
      currency: "COP",
      lineItems: [{ name: `Pago de ${customerName}`, quantity: 1, unitPriceInCents: amountInCents }],
      sendChatwoot: true,
      source: "MANUAL"
    })
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: json?.error || "request_failed" }, { status: res.status });
  }

  return NextResponse.json({
    ok: true,
    checkoutUrl: json?.checkoutUrl || null,
    notificationsScheduled: typeof json?.notificationsScheduled === "number" ? json.notificationsScheduled : null
  });
}
