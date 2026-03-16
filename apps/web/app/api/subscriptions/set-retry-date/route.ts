import { NextResponse } from "next/server";
import { assertCsrfToken } from "../../../lib/csrf";
import { getAdminApiConfig } from "../../../lib/adminApi";

async function adminFetch(path: string, init: RequestInit) {
  const { apiBase, token } = getAdminApiConfig();
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}`, "x-admin-token": token } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, status: res.status, json };
  }
  return { ok: true, status: res.status, json };
}

export async function POST(req: Request) {
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

  const res = await adminFetch(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}/set-retry-date`, {
    method: "POST",
    body: JSON.stringify({ nextRetryAt: nextRetryAt || null })
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: res.json?.error || "set_retry_failed", details: res.json },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json(res.json || { ok: true });
}
