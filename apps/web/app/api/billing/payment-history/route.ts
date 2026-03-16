import { NextResponse } from "next/server";
import { getAdminApiConfig } from "../../../lib/adminApi";

async function adminFetch(path: string, init: RequestInit) {
  const { apiBase, token } = getAdminApiConfig();
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, status: res.status, json };
  }
  return { ok: true, status: res.status, json };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const subscriptionId = String(url.searchParams.get("subscriptionId") || "").trim();
  const tenantId = String(url.searchParams.get("tenantId") || "").trim();
  const takeRaw = Number(url.searchParams.get("take") || "20");
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 50) : 20;
  const pageRaw = Number(url.searchParams.get("page") || "1");
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1;
  const status = String(url.searchParams.get("status") || "").trim();

  if (!subscriptionId) {
    return NextResponse.json({ error: "invalid_subscription_id" }, { status: 400 });
  }

  const qs = new URLSearchParams({ take: String(take), page: String(page) });
  if (tenantId) qs.set("tenantId", tenantId);
  if (status) qs.set("status", status);
  const path = `/admin/payments/subscription/${encodeURIComponent(subscriptionId)}/history?${qs.toString()}`;
  const res = await adminFetch(path, { method: "GET" });

  if (!res.ok) {
    return NextResponse.json(
      { error: res.json?.error || "history_failed", details: res.json },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json(res.json || { items: [] });
}
