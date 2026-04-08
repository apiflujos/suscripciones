import { NextResponse } from "next/server";
import { requireApiSession } from "../../_lib/requireApiSession";
import { getSubscriptionAutoAssociationSuggestions } from "../../../admin/_services/payments";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiSession(req).catch(() => null);
  if (!auth?.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const subscriptionId = url.searchParams.get("subscriptionId");
  if (!subscriptionId) {
    return NextResponse.json({ error: "subscriptionId required" }, { status: 400 });
  }

  const result = await getSubscriptionAutoAssociationSuggestions({
    subscriptionId,
    tenantId: auth.session.tenantId || null
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }

  return NextResponse.json({
    ok: true,
    subscriptionId,
    pendingCyclesCount: result.pendingCyclesCount,
    unlinkedPaymentsCount: result.unlinkedPaymentsCount,
    suggestions: result.suggestions
  });
}
