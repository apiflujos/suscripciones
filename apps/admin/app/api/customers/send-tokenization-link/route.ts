import { NextResponse } from "next/server";
import { normalizeToken } from "../../../lib/normalizeToken";
import { getRequiredApiBase } from "../../../lib/adminApi";
import crypto from "crypto";

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
  const customerName = String(body?.customerName || "").trim() || "Cliente";
  const tenantId = String(body?.tenantId || "").trim();
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const settingsRes = await fetch(`${API_BASE}/admin/settings`, {
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => null);
  const settingsJson = settingsRes && "ok" in settingsRes ? await (settingsRes as any).json().catch(() => null) : null;
  const baseFromSettings = String(settingsJson?.checkoutConfig?.subscriptionBaseUrl || "").trim();
  const appBase = String(process.env.APP_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "").trim();
  const fallbackBase = appBase ? `${appBase.replace(/\/$/, "")}/public/suscripcion` : "";
  const base = (baseFromSettings || fallbackBase).replace(/\/$/, "");
  if (!base) return NextResponse.json({ ok: false, error: "missing_subscription_base_url" }, { status: 400 });

  const linkToken = crypto.randomBytes(18).toString("hex");
  const normalized = base.replace(/\/$/, "");
  const hasSubPath = /\/public\/suscripcion$/i.test(normalized);
  const link = `${normalized}${hasSubPath ? "" : "/public/suscripcion"}/${linkToken}`;
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

  const existing = await fetch(
    `${API_BASE}/admin/customers/${customerId}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`,
    {
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  })
    .then((r) => r.json())
    .catch(() => null);
  const prevMeta = existing?.customer?.metadata ?? {};
  const expiryHours = Number(settingsJson?.checkoutConfig?.tokenExpiryHours || 24);
  const hours = Number.isFinite(expiryHours) && expiryHours > 0 ? Math.min(Math.max(Math.trunc(expiryHours), 1), 168) : 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const nextMeta = {
    ...prevMeta,
    tokenizationLink: {
      url: link,
      token: linkToken,
      createdAt: new Date().toISOString(),
      expiresAt,
      usedAt: null
    }
  };
  const stored = await fetch(
    `${API_BASE}/admin/customers/${customerId}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`,
    {
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
