"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { assertCsrfToken } from "../lib/csrf";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

function mergeQuery(path: string, extra: Record<string, string | undefined>) {
  const url = new URL(path || "/", "http://localhost");
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
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
  if (!res.ok) throw new Error(json?.reason ? `${json?.error || "request_failed"}:${json.reason}` : json?.error || `request_failed_${res.status}`);
  return json;
}

export async function createTenant(formData: FormData) {
  await assertCsrfToken(formData);
  const name = String(formData.get("name") || "").trim();
  const returnTo = String(formData.get("returnTo") || "").trim() || "/";
  if (!name) return redirect(mergeQuery(returnTo, { error: "tenant_name_required" }));

  try {
    const res = await adminFetch("/admin/tenants", { method: "POST", body: JSON.stringify({ name }) });
    const tenantId = res?.tenant?.id ? String(res.tenant.id) : "";
    const url = new URL(returnTo, "http://localhost");
    if (tenantId) url.searchParams.set("tenantId", tenantId);
    url.searchParams.set("tenantCreated", "1");
    redirect(`${url.pathname}${url.search}`);
  } catch (err: any) {
    if (String(err?.digest || "").startsWith("NEXT_REDIRECT")) throw err;
    redirect(mergeQuery(returnTo, { error: String(err?.message || "create_tenant_failed") }));
  }
}
