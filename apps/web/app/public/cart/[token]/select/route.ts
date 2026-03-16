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

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const redirectBase = getRedirectBase(req);
  const apiBase = String(process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  if (!apiBase) {
    return NextResponse.redirect(new URL(`/public/cart/${encodeURIComponent(token)}?error=missing_api_base`, redirectBase));
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.redirect(new URL(`/public/cart/${encodeURIComponent(token)}?error=invalid_form`, redirectBase));
  }
  const planId = String(formData.get("planId") || "").trim();
  if (!planId) {
    return NextResponse.redirect(new URL(`/public/cart/${encodeURIComponent(token)}?error=missing_plan`, redirectBase));
  }

  const res = await fetch(`${apiBase}/public/cart/${encodeURIComponent(token)}/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId }),
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error || `request_failed_${res.status}`;
    return NextResponse.redirect(new URL(`/public/cart/${encodeURIComponent(token)}?error=${encodeURIComponent(msg)}`, redirectBase));
  }
  const nextUrl = String(json?.nextUrl || "").trim();
  if (!nextUrl) {
    return NextResponse.redirect(new URL(`/public/cart/${encodeURIComponent(token)}?error=missing_next_url`, redirectBase));
  }
  return NextResponse.redirect(nextUrl);
}
