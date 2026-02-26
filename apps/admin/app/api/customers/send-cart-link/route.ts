import { NextResponse } from "next/server";
import crypto from "crypto";
import { normalizeToken } from "../../../lib/normalizeToken";
import { getRequiredApiBase } from "../../../lib/adminApi";

function buildPublicUrl(base: string, path: string, utm: string) {
  const normalized = base.replace(/\/$/, "");
  const url = `${normalized}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!utm) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}`;
}

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
  const templateIdInput = String(body?.templateId || "").trim();
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const settingsRes = await fetch(`${API_BASE}/admin/settings`, {
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => null);
  const settingsJson = settingsRes && "ok" in settingsRes ? await (settingsRes as any).json().catch(() => null) : null;
  const checkoutConfig = settingsJson?.checkoutConfig || {};
  const baseFromSettings = String(checkoutConfig?.planBaseUrl || checkoutConfig?.subscriptionBaseUrl || "").trim();
  const appBase = String(process.env.APP_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "").trim();
  const fallbackBase = appBase ? `${appBase.replace(/\/$/, "")}/public/cart` : "";
  const base = (baseFromSettings || fallbackBase).replace(/\/$/, "");
  if (!base) return NextResponse.json({ ok: false, error: "missing_public_base_url" }, { status: 400 });

  const templatesRes = await fetch(
    `${API_BASE}/admin/checkout-templates${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`,
    {
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token },
      cache: "no-store"
    }
  );
  const templatesJson = await templatesRes.json().catch(() => null);
  if (!templatesRes.ok) {
    return NextResponse.json({ ok: false, error: templatesJson?.error || "templates_fetch_failed" }, { status: templatesRes.status });
  }
  const items = Array.isArray(templatesJson?.items) ? templatesJson.items : [];
  const cartTemplates = items.filter((t: any) => String(t?.kind || "") === "CART" && Boolean(t?.active));
  const selectedTemplate =
    (templateIdInput ? cartTemplates.find((t: any) => String(t?.id || "") === templateIdInput) : null) ||
    cartTemplates[0] ||
    null;
  if (!selectedTemplate) {
    return NextResponse.json({ ok: false, error: "missing_cart_template" }, { status: 400 });
  }

  const linkToken = crypto.randomBytes(18).toString("hex");
  const utm = String(checkoutConfig?.defaultUtmParams || "").trim();
  const normalized = base.replace(/\/$/, "");
  const hasCartPath = /\/public\/cart$/i.test(normalized);
  const link = buildPublicUrl(normalized, `${hasCartPath ? "" : "/public/cart"}/${linkToken}`, utm);

  const content = `Hola ${customerName}, aquí puedes elegir tu plan o suscripción: ${link}`;

  const sendRes = await fetch(`${API_BASE}/admin/chatwoot/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ customerId, content })
  });
  const sendJson = await sendRes.json().catch(() => null);
  if (!sendRes.ok) {
    return NextResponse.json({ ok: false, error: sendJson?.error || "request_failed" }, { status: sendRes.status });
  }

  const existing = await fetch(
    `${API_BASE}/admin/customers/${customerId}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`,
    {
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
    }
  )
    .then((r) => r.json())
    .catch(() => null);
  const prevMeta = existing?.customer?.metadata ?? {};
  const expiryHours = Number(checkoutConfig?.tokenExpiryHours || 24);
  const hours = Number.isFinite(expiryHours) && expiryHours > 0 ? Math.min(Math.max(Math.trunc(expiryHours), 1), 168) : 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const nextMeta = {
    ...prevMeta,
    cartLink: {
      url: link,
      token: linkToken,
      templateId: selectedTemplate.id,
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
    }
  );
  if (!stored.ok) {
    return NextResponse.json({ ok: false, error: "store_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, link });
}
