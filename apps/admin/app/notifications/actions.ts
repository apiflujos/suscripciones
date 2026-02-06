"use server";

import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

function normalizeToken(value: string) {
  let v = String(value || "").trim();
  v = v.replace(/^Bearer\s+/i, "").trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || "");

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

async function adminFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, "x-admin-token": TOKEN } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || json?.error || `request_failed_${res.status}`);
  return json;
}

export async function saveNotificationsConfig(formData: FormData) {
  const environment = String(formData.get("environment") || "").trim().toUpperCase();
  const raw = String(formData.get("configJson") || "").trim();

  try {
    const parsed = raw ? JSON.parse(raw) : null;
    await adminFetch("/admin/notifications/config", {
      method: "PUT",
      body: JSON.stringify({
        ...(environment === "PRODUCTION" || environment === "SANDBOX" ? { environment } : {}),
        config: parsed
      })
    });
    redirect("/notifications?saved=1");
  } catch (err) {
    redirect(`/notifications?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function scheduleSubscription(formData: FormData) {
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const forceNow = String(formData.get("forceNow") || "").trim() === "1";
  if (!subscriptionId) return redirect("/notifications?error=missing_subscription_id");

  try {
    const qs = forceNow ? "?forceNow=1" : "";
    const result = await adminFetch(`/admin/notifications/schedule/subscription/${encodeURIComponent(subscriptionId)}${qs}`, { method: "POST" });
    redirect(`/notifications?scheduled=${encodeURIComponent(String(result?.scheduled ?? 0))}`);
  } catch (err) {
    redirect(`/notifications?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

