import { NextResponse } from "next/server";
import { normalizeToken } from "../../../lib/normalizeToken";
import { getRequiredApiBase } from "../../../lib/adminApi";
import crypto from "crypto";

function buildChatwootLinkMessage(args: { name?: string; lead: string; url: string }) {
  const safeName = String(args.name || "Cliente").trim() || "Cliente";
  const safeLead = String(args.lead || "").trim();
  const safeUrl = String(args.url || "").trim();
  const leadLine = safeLead ? `**${safeLead}**` : "";
  return [`Hola ${safeName},`, "", leadLine, safeUrl].filter((line) => line !== "").join("\n");
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
  const templateId = String(body?.templateId || "").trim();
  if (!customerId) return NextResponse.json({ ok: false, error: "missing_customer_id" }, { status: 400 });

  const settingsRes = await fetch(`${API_BASE}/admin/settings`, {
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  }).catch(() => null);
  const settingsJson = settingsRes && "ok" in settingsRes ? await (settingsRes as any).json().catch(() => null) : null;
  const baseFromSettings = String(settingsJson?.checkoutConfig?.subscriptionBaseUrl || "").trim();
  const base = baseFromSettings.replace(/\/$/, "");
  if (!base) return NextResponse.json({ ok: false, error: "missing_subscription_base_url" }, { status: 400 });

  const ensureHttps = (value: string) => {
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value.replace(/^\/+/, "")}`;
  };

  const linkToken = crypto.randomBytes(18).toString("hex");
  const normalized = ensureHttps(base).replace(/\/$/, "");
  const hasSubPath = /\/public\/suscripcion$/i.test(normalized);
  const link = `${normalized}${hasSubPath ? "" : "/public/suscripcion"}/${linkToken}`;

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
      ...(templateId ? { templateId } : {}),
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

  const scheduleRes = await fetch(`${API_BASE}/admin/notifications/schedule/tokenization?forceNow=1`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ customerId, tokenUrl: link })
  });
  const scheduleJson = await scheduleRes.json().catch(() => null);
  if (!scheduleRes.ok) {
    return NextResponse.json({ ok: false, error: scheduleJson?.error || "request_failed" }, { status: scheduleRes.status });
  }
  const rulesActive = Boolean(scheduleJson?.rulesActive);

  let chatwootError: string | null = null;
  let fallbackSent = false;
  if (!rulesActive) {
    const msg = buildChatwootLinkMessage({
      name: customerName || "Cliente",
      lead: "Activa tu suscripción guardando tu método de pago aquí:",
      url: link
    });
    try {
      const chatRes = await fetch(`${API_BASE}/admin/chatwoot/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-admin-token": token,
          "content-type": "application/json"
        },
        body: JSON.stringify({ customerId, content: msg })
      });
      if (!chatRes.ok) {
        const chatJson = await chatRes.json().catch(() => null);
        chatwootError = String(chatJson?.error || chatJson?.message || `chatwoot_error_${chatRes.status}`);
      } else {
        fallbackSent = true;
      }
    } catch (err: any) {
      chatwootError = String(err?.message || "chatwoot_request_failed");
    }
  }

  return NextResponse.json({
    ok: true,
    link,
    notificationsScheduled: scheduleJson?.scheduled ?? 0,
    notificationsSent: scheduleJson?.sentNow ?? 0,
    notificationsRulesActive: rulesActive,
    chatwootError,
    fallbackSent
  });
}
