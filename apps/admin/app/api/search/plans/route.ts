import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { searchPlans } from "../../../admin/_services/search";

export async function GET(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") || "").trim();
  const tenantId = String(searchParams.get("tenantId") || "").trim();
  const take = String(searchParams.get("take") || "80").trim();
  const takeNum = Number(take);
  const effectiveTenantId = tenantId || (auth.session.role === "SUPER_ADMIN" ? null : auth.session.tenantId || null);
  const items = await searchPlans({ q, take: Number.isFinite(takeNum) ? takeNum : 80, tenantId: effectiveTenantId });
  return NextResponse.json({ items });
}
