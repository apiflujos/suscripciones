import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiSession } from "../../../_lib/requireApiSession";
import { getCustomerPayments } from "../../../../admin/_services/payments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: any) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const id = String(context?.params?.id || "").trim();
  if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") || 50);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 200) : 50;
  const skipRaw = Number(url.searchParams.get("skip") || 0);
  const skip = Number.isFinite(skipRaw) ? Math.max(Math.trunc(skipRaw), 0) : 0;

  const result = await getCustomerPayments({ customerId: id, tenantId: auth.session.tenantId || null, take, skip });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ items: result.items });
}
