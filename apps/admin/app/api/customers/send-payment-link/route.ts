import { NextResponse } from "next/server";
import crypto from "crypto";
import { normalizeToken } from "../../../lib/normalizeToken";
import { getRequiredApiBase } from "../../../lib/adminApi";

function pesosToCents(input: string): number {
  const digits = String(input || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
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
      ...(tenantId ? { tenantId } : {}),
      sendChatwoot: true,
      source: "MANUAL"
    })
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: json?.error || "request_failed" }, { status: res.status });
  }

  const checkoutUrl = String(json?.checkoutUrl || "").trim();
  let publicUrl: string | null = null;
  try {
    const settingsRes = await fetch(`${API_BASE}/admin/settings`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token
      },
      cache: "no-store"
    });
    const settingsJson = await settingsRes.json().catch(() => null);
    const checkoutConfig = settingsJson?.checkoutConfig || {};
    const baseFromSettings = String(checkoutConfig?.planBaseUrl || "").trim();
    if (!baseFromSettings) {
      return NextResponse.json({ ok: false, error: "missing_plan_base_url" }, { status: 400 });
    }
    const base = baseFromSettings;
    if (base) {
      const tokenValue = crypto.randomBytes(18).toString("hex");
      const normalized = base.replace(/\/$/, "");
      const hasPlanPath = /\/public\/plan$/i.test(normalized);
      const baseUrl = `${normalized}${hasPlanPath ? "" : "/public/plan"}/${tokenValue}`;
      const utm = String(checkoutConfig?.defaultUtmParams || "").trim();
      publicUrl = utm ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${utm.replace(/^\?+/, "")}` : baseUrl;

      const customerRes = await fetch(`${API_BASE}/admin/customers/${encodeURIComponent(customerId)}`, {
        headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
      });
      const customerJson = await customerRes.json().catch(() => null);
      const prevMeta = customerJson?.customer?.metadata ?? {};
      const nextMeta = {
        ...prevMeta,
        paymentLink: {
          url: publicUrl,
          token: tokenValue,
          checkoutUrl,
          kind: "PLAN",
          templateId: templateId || null,
          utmParams: checkoutConfig?.defaultUtmParams || null,
          createdAt: new Date().toISOString(),
          expiresAt: null,
          usedAt: null
        }
      };
      await fetch(`${API_BASE}/admin/customers/${encodeURIComponent(customerId)}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "x-admin-token": token,
          "content-type": "application/json"
        },
        body: JSON.stringify({ metadata: nextMeta })
      });

      let chatwootError: string | null = null;
      const msg = `Hola ${customerName || "Cliente"}, aquí está tu link de pago: ${publicUrl}`;
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
        }
      } catch (err: any) {
        chatwootError = String(err?.message || "chatwoot_request_failed");
      }

      return NextResponse.json({
        ok: true,
        checkoutUrl: checkoutUrl || null,
        publicUrl,
        notificationsScheduled: typeof json?.notificationsScheduled === "number" ? json.notificationsScheduled : null,
        chatwootError
      });
    }
  } catch {
    // ignore best-effort public link
  }

  return NextResponse.json({
    ok: true,
    checkoutUrl: checkoutUrl || null,
    publicUrl,
    notificationsScheduled: typeof json?.notificationsScheduled === "number" ? json.notificationsScheduled : null,
    chatwootError: null
  });
}
