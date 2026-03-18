import { NextResponse } from "next/server";
import { assertCsrfToken } from "../../../lib/csrf";
import { requireApiSession } from "../../_lib/requireApiSession";
import { setSubscriptionRetryDate } from "../../../admin/_services/subscriptions";

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const formData = await req.formData();
  try {
    await assertCsrfToken(formData);
  } catch {
    return NextResponse.json({ error: "csrf_invalid" }, { status: 403 });
  }

  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const nextRetryAt = String(formData.get("nextRetryAt") || "").trim();

  if (!subscriptionId) {
    return NextResponse.json({ error: "invalid_subscription_id" }, { status: 400 });
  }

  const result = await setSubscriptionRetryDate({
    subscriptionId,
    nextRetryAt: nextRetryAt || null,
    tenantId: auth.session.tenantId || null
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }
  return NextResponse.json({ ok: true, subscription: result.subscription });
}
