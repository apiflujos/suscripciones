import { NextResponse } from "next/server";
import { normalizeToken } from "../../../lib/normalizeToken";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const ADMIN_BASE =
  (process.env.NEXT_PUBLIC_ADMIN_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();

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
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });
  if (!ADMIN_BASE) return NextResponse.json({ ok: false, error: "missing_admin_base_url" }, { status: 400 });

  const base = ADMIN_BASE.replace(/\/$/, "");
  const link = `${base}/customers/${customerId}/payment-method`;
  const content = `Hola ${customerName}, para activar tu suscripción guarda tu método de pago aquí: ${link}`;

  const res = await fetch(`${API_BASE}/admin/chatwoot/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ customerId, content })
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: json?.error || "request_failed" }, { status: res.status });
  }

  const existing = await fetch(`${API_BASE}/admin/customers/${customerId}`, {
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  })
    .then((r) => r.json())
    .catch(() => null);
  const prevMeta = existing?.customer?.metadata ?? {};
  const nextMeta = {
    ...prevMeta,
    tokenizationLink: {
      url: link,
      createdAt: new Date().toISOString()
    }
  };
  const stored = await fetch(`${API_BASE}/admin/customers/${customerId}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ metadata: nextMeta })
  });
  if (!stored.ok) {
    return NextResponse.json({ ok: false, error: "store_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, link });
}
