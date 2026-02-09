import { NextResponse } from "next/server";

function getConfig() {
  const raw = String(process.env.ADMIN_API_TOKEN || "");
  const token = raw.replace(/^Bearer\\s+/i, "").trim().replace(/^\"|\"$/g, "").replace(/^'|'$/g, "").trim();
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

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const { apiBase, token } = getConfig();
  if (!token) return NextResponse.redirect(new URL(`/customers/${ctx.params.id}/payment-method?error=missing_admin_token`, req.url));

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.redirect(new URL(`/customers/${ctx.params.id}/payment-method?error=invalid_form`, req.url));

  const wompiToken = detectToken(formData);
  if (!wompiToken) return NextResponse.redirect(new URL(`/customers/${ctx.params.id}/payment-method?error=missing_token`, req.url));

  const type = tokenToType(wompiToken);

  try {
    const res = await fetch(`${apiBase}/admin/customers/${ctx.params.id}/wompi/payment-source`, {
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
      return NextResponse.redirect(new URL(`/customers/${ctx.params.id}/payment-method?error=${encodeURIComponent(msg)}`, req.url));
    }

    return NextResponse.redirect(new URL(`/customers?paymentSource=1`, req.url));
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "request_failed";
    return NextResponse.redirect(new URL(`/customers/${ctx.params.id}/payment-method?error=${encodeURIComponent(msg)}`, req.url));
  }
}
