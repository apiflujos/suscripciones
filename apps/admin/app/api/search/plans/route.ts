import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { searchPlans } from "../../../admin/_services/search";

export async function GET(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") || "").trim();
  const tenantId = String(searchParams.get("tenantId") || "").trim();
  const take = String(searchParams.get("take") || "80").trim();
  const takeNum = Number(take);
  const items = await searchPlans({ q, take: Number.isFinite(takeNum) ? takeNum : 80, tenantId: tenantId || auth.session.tenantId || null });
  return NextResponse.json({ items });
}
