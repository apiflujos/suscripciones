import { NextResponse } from "next/server";

function getRedirectBase(req: Request) {
  const envBase =
    String(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "").trim() ||
    String(process.env.NEXT_PUBLIC_REDIRECT_BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  if (host) {
    const proto = forwardedProto || "https";
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

function getConfig() {
  const raw = String(process.env.ADMIN_API_TOKEN || "");
  const token = raw.replace(/^Bearer\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
  const apiBase = String(process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  if (!apiBase) throw new Error("missing_next_public_api_base_url");
  return {
    apiBase,
    token
  };
}

function detectToken(formData: FormData): string {
  const direct =
    String(formData.get("token") || "").trim() ||
    String(formData.get("wompi_token") || "").trim() ||
    String(formData.get("id") || "").trim();
  if (direct) return direct;

  for (const [, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!v) continue;
    if (v.startsWith("tok_") || v.startsWith("nequi_") || v.startsWith("pse_")) return v;
  }
  return "";
}

function tokenToType(token: string): "CARD" | "NEQUI" | "PSE" {
  if (token.startsWith("nequi_")) return "NEQUI";
  if (token.startsWith("pse_")) return "PSE";
  return "CARD";
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token: linkToken } = await ctx.params;
  const redirectBase = getRedirectBase(req);
  let apiBase = "";
  let token = "";
  try {
    const cfg = getConfig();
    apiBase = cfg.apiBase;
    token = cfg.token;
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "missing_next_public_api_base_url";
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, redirectBase));
  }
  if (!token) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_admin_token`, redirectBase));

  const tokenRes = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(linkToken)}`, { cache: "no-store" });
  const tokenJson = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok) {
    const msg = tokenJson?.error || `request_failed_${tokenRes.status}`;
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, redirectBase));
  }

  const customerId = String(tokenJson?.customer?.id || "").trim();
  const linkPlanId = String(tokenJson?.link?.planId || tokenJson?.template?.planId || "").trim();
  const linkKind = String(tokenJson?.link?.kind || tokenJson?.template?.kind || "").trim();
  const usedAt = String(tokenJson?.link?.usedAt || "").trim();
  if (usedAt) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=token_used`, redirectBase));
  }
  if (!customerId) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=customer_not_found`, redirectBase));

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=invalid_form`, redirectBase));

  const wompiToken = detectToken(formData);
  if (!wompiToken) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_token`, redirectBase));

  const type = tokenToType(wompiToken);

  try {
    const consumeRes = await fetch(`${apiBase}/admin/customers/tokenization-links/${encodeURIComponent(linkToken)}/consume`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token
      },
      cache: "no-store"
    });
    const consumeJson = await consumeRes.json().catch(() => null);
    if (!consumeRes.ok) {
      const code = String(consumeJson?.error || `request_failed_${consumeRes.status}`);
      return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(code)}`, redirectBase));
    }

    const res = await fetch(`${apiBase}/admin/customers/${customerId}/wompi/payment-source`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token,
        "content-type": "application/json"
      },
      body: JSON.stringify({ type, token: wompiToken }),
      cache: "no-store"
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error || `request_failed_${res.status}`;
      return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, redirectBase));
    }

    const existing = await fetch(`${apiBase}/admin/customers/${customerId}`, {
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
    })
      .then((r) => r.json())
      .catch(() => null);
    const prevMeta = existing?.customer?.metadata ?? {};
    const prevTokenizationLink = prevMeta?.tokenizationLink || {};
    const nextMeta = {
      ...prevMeta,
      tokenizationLink: {
        ...prevTokenizationLink,
        usedAt: prevTokenizationLink?.usedAt || new Date().toISOString()
      }
    };

    await fetch(`${apiBase}/admin/customers/${customerId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token,
        "content-type": "application/json"
      },
      body: JSON.stringify({ metadata: nextMeta })
    });

    if (linkKind === "SUBSCRIPTION" && linkPlanId) {
      try {
        const subRes = await fetch(`${apiBase}/admin/subscriptions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-admin-token": token,
            "content-type": "application/json"
          },
          body: JSON.stringify({ customerId, planId: linkPlanId, createPaymentLink: false }),
          cache: "no-store"
        });
        const subJson = await subRes.json().catch(() => null);
        if (subRes.ok && subJson?.subscription?.id) {
          const finalMeta = {
            ...nextMeta,
            tokenizationLink: {
              ...(nextMeta?.tokenizationLink || {}),
              subscriptionId: subJson.subscription.id
            }
          };
          await fetch(`${apiBase}/admin/customers/${customerId}`, {
            method: "PUT",
            headers: {
              authorization: `Bearer ${token}`,
              "x-admin-token": token,
              "content-type": "application/json"
            },
            body: JSON.stringify({ metadata: finalMeta })
          });
        }
      } catch {}
    }

    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}/success`, redirectBase));
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "request_failed";
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, redirectBase));
  }
}
