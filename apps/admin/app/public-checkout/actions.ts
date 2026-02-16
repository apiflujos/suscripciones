"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { assertCsrfToken } from "../lib/csrf";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function redirectWith(action: string, status: "ok" | "fail", error?: string) {
  const qp = new URLSearchParams({ a: action, status });
  if (error) qp.set("error", error);
  redirect(`/public-checkout?${qp.toString()}`);
}

function normalizeUrl(input: string) {
  const v = String(input || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

async function adminFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`,
    {
      ...init,
      headers: {
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, "x-admin-token": TOKEN } : {}),
        "content-type": "application/json",
        ...(init.headers ?? {})
      },
      cache: "no-store"
    }
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const status = res.status;
    const details =
      json?.error && json?.status && json?.text
        ? `${json.error} (status ${json.status}): ${json.text}`
        : json?.reason
          ? `${json?.error || "request_failed"}:${json.reason}`
          : json?.message || json?.error || `request_failed_${status}`;
    throw new Error(details);
  }
  return json;
}

function buildBranding(formData: FormData) {
  return {
    title: String(formData.get("brandTitle") || "").trim() || undefined,
    subtitle: String(formData.get("brandSubtitle") || "").trim() || undefined,
    description: String(formData.get("brandDescription") || "").trim() || undefined,
    logoUrl: String(formData.get("brandLogoUrl") || "").trim() || undefined,
    primaryColor: String(formData.get("brandPrimaryColor") || "").trim() || undefined,
    fontFamily: String(formData.get("brandFontFamily") || "").trim() || undefined,
    contactEmail: String(formData.get("brandContactEmail") || "").trim() || undefined,
    successTitle: String(formData.get("brandSuccessTitle") || "").trim() || undefined,
    successSubtitle: String(formData.get("brandSuccessSubtitle") || "").trim() || undefined,
    successButtonText: String(formData.get("brandSuccessButtonText") || "").trim() || undefined,
    redirectUrl: String(formData.get("brandRedirectUrl") || "").trim() || undefined
  };
}

export async function updatePublicCheckoutDefaults(formData: FormData) {
  await assertCsrfToken(formData);
  const baseUrl = normalizeUrl(String(formData.get("publicBaseUrl") || ""));
  const title = String(formData.get("publicTitle") || "").trim();
  const subtitle = String(formData.get("publicSubtitle") || "").trim();
  const description = String(formData.get("publicDescription") || "").trim();
  const contactEmail = String(formData.get("publicContactEmail") || "").trim();
  const tokenExpiryHours = String(formData.get("publicTokenExpiryHours") || "").trim();

  try {
    await adminFetch("/admin/settings/public-checkout", {
      method: "PUT",
      body: JSON.stringify({
        ...(baseUrl ? { baseUrl } : { baseUrl: "" }),
        ...(title ? { title } : { title: "" }),
        ...(subtitle ? { subtitle } : { subtitle: "" }),
        ...(description ? { description } : { description: "" }),
        ...(contactEmail ? { contactEmail } : { contactEmail: "" }),
        ...(tokenExpiryHours ? { tokenExpiryHours: Number(tokenExpiryHours) } : {})
      })
    });
    redirectWith("public_defaults", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("public_defaults", "fail", toShortErrorMessage(err));
  }
}

export async function createPublicCheckoutTemplate(formData: FormData) {
  await assertCsrfToken(formData);
  const name = String(formData.get("name") || "").trim();
  const slug = String(formData.get("slug") || "").trim();
  const kind = String(formData.get("kind") || "PLAN").trim();
  const active = String(formData.get("active") || "").trim() === "on";
  const allowPlanSelect = String(formData.get("allowPlanSelect") || "").trim() === "on";
  const planId = String(formData.get("planId") || "").trim();
  const requireShipping = String(formData.get("requireShipping") || "").trim() === "on";
  const requireAddress = String(formData.get("requireAddress") || "").trim() === "on";

  try {
    await adminFetch("/admin/public-checkout/templates", {
      method: "POST",
      body: JSON.stringify({
        name,
        ...(slug ? { slug } : {}),
        kind,
        active,
        allowPlanSelect,
        ...(planId ? { planId } : {}),
        requireShipping,
        requireAddress,
        branding: buildBranding(formData)
      })
    });
    redirectWith("template_create", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("template_create", "fail", toShortErrorMessage(err));
  }
}

export async function updatePublicCheckoutTemplate(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const slug = String(formData.get("slug") || "").trim();
  const kind = String(formData.get("kind") || "PLAN").trim();
  const active = String(formData.get("active") || "").trim() === "on";
  const allowPlanSelect = String(formData.get("allowPlanSelect") || "").trim() === "on";
  const planId = String(formData.get("planId") || "").trim();
  const requireShipping = String(formData.get("requireShipping") || "").trim() === "on";
  const requireAddress = String(formData.get("requireAddress") || "").trim() === "on";

  try {
    await adminFetch(`/admin/public-checkout/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name,
        ...(slug ? { slug } : {}),
        kind,
        active,
        allowPlanSelect,
        ...(planId ? { planId } : {}),
        requireShipping,
        requireAddress,
        branding: buildBranding(formData)
      })
    });
    redirectWith("template_update", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("template_update", "fail", toShortErrorMessage(err));
  }
}

export async function deactivatePublicCheckoutTemplate(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  try {
    await adminFetch(`/admin/public-checkout/templates/${id}`, { method: "DELETE" });
    redirectWith("template_disable", "ok");
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirectWith("template_disable", "fail", toShortErrorMessage(err));
  }
}
