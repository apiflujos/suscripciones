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

function normalizeRedirectBase(raw: string) {
  const input = String(raw || "").trim().replace(/\/+$/g, "");
  if (!input) return "";
  try {
    const parsed = new URL(input);
    return parsed.origin;
  } catch {
    return input.replace(/\/public\/(plan|suscripcion)(\/.*)?$/i, "");
  }
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
  let redirectBase = getRedirectBase(req);
  let apiBase = "";
  let token = "";
  try {
    const cfg = getConfig();
    apiBase = cfg.apiBase;
    token = cfg.token;
    const configRes = await fetch(`${apiBase}/public/checkout-config`, { cache: "no-store" }).catch(() => null);
    const configJson = configRes && "ok" in configRes ? await (configRes as any).json().catch(() => null) : null;
    const configBase = String(configJson?.config?.subscriptionBaseUrl || "").trim();
    const normalized = normalizeRedirectBase(configBase);
    if (normalized) redirectBase = normalized;
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
  const customerEmail = String(tokenJson?.customer?.email || "").trim();
  const linkPlanId = String(tokenJson?.link?.planId || tokenJson?.template?.planId || "").trim();
  const linkKind = String(tokenJson?.link?.kind || tokenJson?.template?.kind || "").trim();
  const usedAt = String(tokenJson?.link?.usedAt || "").trim();
  if (usedAt) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=token_used`, redirectBase));
  }
  if (!customerId) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=customer_not_found`, redirectBase));
  if (!customerEmail) {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=customer_email_required`, redirectBase));
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=invalid_form`, redirectBase));
  const acceptTerms = String(formData.get("accept_terms") || "").trim();
  const acceptPersonal = String(formData.get("accept_personal_data") || "").trim();
  if (acceptTerms !== "1" || acceptPersonal !== "1") {
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_acceptance`, redirectBase));
  }

  const wompiToken = detectToken(formData);
  if (!wompiToken) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_token`, redirectBase));

  const type = tokenToType(wompiToken);

  try {
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

    await fetch(`${apiBase}/admin/customers/tokenization-links/${encodeURIComponent(linkToken)}/consume`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-admin-token": token
      },
      cache: "no-store"
    }).catch(() => null);

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
