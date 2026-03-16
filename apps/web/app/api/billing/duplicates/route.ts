import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminApiConfig } from "../../../lib/adminApi";

const ACTIVE_STATUSES = new Set(["ACTIVE", "PAST_DUE", "SUSPENDED", "EXPIRED"]);

export async function GET(req: NextRequest) {
  const { apiBase, token } = getAdminApiConfig();
  if (!token) return NextResponse.json({ error: "missing_admin_token" }, { status: 401 });

  const url = new URL(req.url);
  const customerId = String(url.searchParams.get("customerId") || "").trim();
  const productId = String(url.searchParams.get("productId") || "").trim();
  const tenantId = String(url.searchParams.get("tenantId") || "").trim();
  if (!customerId || !productId) return NextResponse.json({ duplicatesCount: 0, items: [] });

  const qp = new URLSearchParams({
    customerId,
    take: "300",
    ...(tenantId ? { tenantId } : {})
  });

  const res = await fetch(`${apiBase}/admin/subscriptions?${qp.toString()}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "x-admin-token": token }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(json, { status: res.status });

  const items = Array.isArray(json?.items) ? json.items : [];
  const duplicates = items
    .filter((s: any) => ACTIVE_STATUSES.has(String(s?.status || "").toUpperCase()))
    .filter((s: any) => String(s?.plan?.metadata?.catalog?.itemId || "").trim() === productId)
    .map((s: any) => ({
      id: String(s?.id || ""),
      status: String(s?.status || ""),
      planId: String(s?.planId || s?.plan?.id || ""),
      planName: String(s?.plan?.name || "")
    }))
    .filter((s: any) => s.id);

  return NextResponse.json({ duplicatesCount: duplicates.length, items: duplicates });
}
