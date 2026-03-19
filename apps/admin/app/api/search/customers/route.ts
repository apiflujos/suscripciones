import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { searchCustomers } from "../../../admin/_services/search";

export async function GET(req: NextRequest) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const tenantId = String(url.searchParams.get("tenantId") || "").trim();
  const takeRaw = Number(url.searchParams.get("take") || 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;

  if (!q) return NextResponse.json({ items: [] });

  const effectiveTenantId = tenantId || (auth.session.role === "SUPER_ADMIN" ? null : auth.session.tenantId || null);
  const items = await searchCustomers({ q, take, tenantId: effectiveTenantId });
  return NextResponse.json({ items });
}
