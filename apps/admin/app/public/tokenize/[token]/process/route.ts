import { NextResponse } from "next/server";

function getConfig() {
  const raw = String(process.env.ADMIN_API_TOKEN || "");
  const token = raw.replace(/^Bearer\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
  return {
    apiBase: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
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
  const { apiBase, token } = getConfig();
  if (!token) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_admin_token`, req.url));

  const tokenRes = await fetch(`${apiBase}/public/tokenization-links/${encodeURIComponent(linkToken)}`, { cache: "no-store" });
  const tokenJson = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok) {
    const msg = tokenJson?.error || `request_failed_${tokenRes.status}`;
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, req.url));
  }

  const customerId = String(tokenJson?.customer?.id || "").trim();
  if (!customerId) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=customer_not_found`, req.url));

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=invalid_form`, req.url));

  const wompiToken = detectToken(formData);
  if (!wompiToken) return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=missing_token`, req.url));

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
      return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, req.url));
    }

    const existing = await fetch(`${apiBase}/admin/customers/${customerId}`, {
      headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
    })
      .then((r) => r.json())
      .catch(() => null);
    const prevMeta = existing?.customer?.metadata ?? {};
    const nextMeta = {
      ...prevMeta,
      tokenizationLink: {
        ...(prevMeta?.tokenizationLink || {}),
        usedAt: new Date().toISOString()
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

    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}/success`, req.url));
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "request_failed";
    return NextResponse.redirect(new URL(`/public/tokenize/${linkToken}?error=${encodeURIComponent(msg)}`, req.url));
  }
}
