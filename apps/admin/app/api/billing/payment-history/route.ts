import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getSubscriptionPaymentHistory, searchSubscriptionPaymentCandidates } from "../../../admin/_services/payments";

export async function GET(req: Request) {
  const auth = await requireApiSession(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const subscriptionId = String(url.searchParams.get("subscriptionId") || "").trim();
  const tenantId = String(url.searchParams.get("tenantId") || "").trim();
  const takeRaw = Number(url.searchParams.get("take") || "20");
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(Math.trunc(takeRaw), 1), 50) : 20;
  const pageRaw = Number(url.searchParams.get("page") || "1");
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1;
  const status = String(url.searchParams.get("status") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim();
  const includeUnlinked = String(url.searchParams.get("includeUnlinked") || "").trim() === "1";

  if (!subscriptionId) {
    return NextResponse.json({ error: "invalid_subscription_id" }, { status: 400 });
  }

  if (includeUnlinked) {
    const result = await searchSubscriptionPaymentCandidates({
      subscriptionId,
      tenantId: tenantId || auth.session.tenantId || null,
      q,
      take
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }
    return NextResponse.json({
      total: result.items.length,
      page: 1,
      take,
      items: result.items
    });
  }

  const result = await getSubscriptionPaymentHistory({
    subscriptionId,
    tenantId: tenantId || auth.session.tenantId || null,
    take,
    page,
    status
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }
  return NextResponse.json({
    total: result.total,
    page: result.page,
    take: result.take,
    items: result.items
  });
}
