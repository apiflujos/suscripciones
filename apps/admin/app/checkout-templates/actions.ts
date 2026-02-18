"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { assertCsrfToken } from "../lib/csrf";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

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
  if (!res.ok) {
    throw new Error(json?.error || "request_failed");
  }
  return json;
}

function redirectWith(action: string, status: "ok" | "fail", error?: string) {
  const qp = new URLSearchParams({ a: action, status, tab: "checkout-publico" });
  if (error) qp.set("error", error);
  redirect(`/settings?${qp.toString()}`);
}

export async function createCheckoutTemplate(formData: FormData) {
  await assertCsrfToken(formData);
  try {
    let layout: any = {};
    try {
      layout = JSON.parse(String(formData.get("layout") || "{}"));
    } catch {
      layout = {};
    }
    const payload = {
      name: String(formData.get("name") || "").trim(),
      kind: String(formData.get("kind") || "PLAN").trim().toUpperCase(),
      active: String(formData.get("active") || "") === "on",
      allowProductSelect: String(formData.get("allowProductSelect") || "") === "on",
      productIds: String(formData.get("productIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      expiryHours: Number(String(formData.get("expiryHours") || "")) || undefined,
      logoUrl: String(formData.get("logoUrl") || "").trim(),
      publicTitle: String(formData.get("publicTitle") || "").trim(),
      publicDescription: String(formData.get("publicDescription") || "").trim(),
      wompiTitle: String(formData.get("wompiTitle") || "").trim(),
      wompiDescription: String(formData.get("wompiDescription") || "").trim(),
      utmParams: String(formData.get("utmParams") || "").trim(),
      layout
    };
    await adminFetch("/admin/checkout-templates", { method: "POST", body: JSON.stringify(payload) });
    redirectWith("checkout_template_create", "ok");
  } catch (err: any) {
    redirectWith("checkout_template_create", "fail", String(err?.message || "create_failed"));
  }
}

export async function updateCheckoutTemplate(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirectWith("checkout_template_update", "fail", "missing_id");
  try {
    let layout: any = {};
    try {
      layout = JSON.parse(String(formData.get("layout") || "{}"));
    } catch {
      layout = {};
    }
    const payload = {
      name: String(formData.get("name") || "").trim(),
      kind: String(formData.get("kind") || "PLAN").trim().toUpperCase(),
      active: String(formData.get("active") || "") === "on",
      allowProductSelect: String(formData.get("allowProductSelect") || "") === "on",
      productIds: String(formData.get("productIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      expiryHours: Number(String(formData.get("expiryHours") || "")) || undefined,
      logoUrl: String(formData.get("logoUrl") || "").trim(),
      publicTitle: String(formData.get("publicTitle") || "").trim(),
      publicDescription: String(formData.get("publicDescription") || "").trim(),
      wompiTitle: String(formData.get("wompiTitle") || "").trim(),
      wompiDescription: String(formData.get("wompiDescription") || "").trim(),
      utmParams: String(formData.get("utmParams") || "").trim(),
      layout
    };
    await adminFetch(`/admin/checkout-templates/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    redirectWith("checkout_template_update", "ok");
  } catch (err: any) {
    redirectWith("checkout_template_update", "fail", String(err?.message || "update_failed"));
  }
}

export async function deleteCheckoutTemplate(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirectWith("checkout_template_delete", "fail", "missing_id");
  try {
    await adminFetch(`/admin/checkout-templates/${id}`, { method: "DELETE" });
    redirectWith("checkout_template_delete", "ok");
  } catch (err: any) {
    redirectWith("checkout_template_delete", "fail", String(err?.message || "delete_failed"));
  }
}
