import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminApiConfig } from "../../../lib/adminApi";

export async function GET(req: NextRequest) {
  const { apiBase, token } = getAdminApiConfig();
  if (!token) return NextResponse.json({ error: "missing_admin_token" }, { status: 401 });

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const takeRaw = Number(url.searchParams.get("take") || 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500) : 50;

  if (!q) return NextResponse.json({ items: [] });

  const res = await fetch(
    `${apiBase}/admin/products?${new URLSearchParams({ q, take: String(take) }).toString()}`,
    { cache: "no-store", headers: { authorization: `Bearer ${token}`, "x-admin-token": token } }
  );
  const json = await res.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(json, { status: res.status });
}

