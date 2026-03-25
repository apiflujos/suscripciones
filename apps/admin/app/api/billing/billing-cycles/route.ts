import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { listSubscriptionBillingCycles } from "../../../admin/_services/payments";

export async function GET(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const subscriptionId = String(url.searchParams.get("subscriptionId") || "").trim();
  const takeRaw = Number(url.searchParams.get("take") || "24");
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 60) : 24;

  if (!subscriptionId) {
    return NextResponse.json({ error: "invalid_subscription_id" }, { status: 400 });
  }

  const result = await listSubscriptionBillingCycles({ subscriptionId, take });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }
  return NextResponse.json({ items: result.items });
}
