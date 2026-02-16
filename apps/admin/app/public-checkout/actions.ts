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
  redirect(`/settings?tab=public-checkout&${qp.toString()}`);
}

function normalizeUrl(input: string) {
  const v = String(input || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function toSlug(input: string) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
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

function buildBranding(_formData: FormData) {
  return {};
}

export async function updatePublicCheckoutDefaults(formData: FormData) {
  await assertCsrfToken(formData);
  const domainMode = String(formData.get("publicDomainMode") || "").trim() || "apiflujos";
  const companyName = String(formData.get("publicCompanyName") || "").trim();
  const customDomain = String(formData.get("publicCustomDomain") || "").trim();
  const baseUrlRaw = String(formData.get("publicBaseUrl") || "").trim();
  const baseUrl =
    domainMode === "custom"
      ? normalizeUrl(customDomain || baseUrlRaw)
      : companyName
        ? normalizeUrl(`${toSlug(companyName)}.subs.apiflujos.com`)
        : normalizeUrl(baseUrlRaw);
  const title = String(formData.get("publicTitle") || "").trim();
  const subtitle = String(formData.get("publicSubtitle") || "").trim();
  const description = String(formData.get("publicDescription") || "").trim();
  const contactEmail = String(formData.get("publicContactEmail") || "").trim();
  const tokenExpiryHours = String(formData.get("publicTokenExpiryHours") || "").trim();
  const logoUrl = normalizeUrl(String(formData.get("publicLogoUrl") || "").trim());
  const primaryColor = String(formData.get("publicPrimaryColor") || "").trim();
  const fontFamily = String(formData.get("publicFontFamily") || "").trim();
  const successTitle = String(formData.get("publicSuccessTitle") || "").trim();
  const successSubtitle = String(formData.get("publicSuccessSubtitle") || "").trim();
  const successButtonText = String(formData.get("publicSuccessButtonText") || "").trim();
  const redirectUrl = normalizeUrl(String(formData.get("publicRedirectUrl") || "").trim());

  try {
    await adminFetch("/admin/settings/public-checkout", {
      method: "PUT",
      body: JSON.stringify({
        ...(baseUrl ? { baseUrl } : { baseUrl: "" }),
        ...(title ? { title } : { title: "" }),
        ...(subtitle ? { subtitle } : { subtitle: "" }),
        ...(description ? { description } : { description: "" }),
        ...(contactEmail ? { contactEmail } : { contactEmail: "" }),
        ...(tokenExpiryHours ? { tokenExpiryHours: Number(tokenExpiryHours) } : {}),
        ...(logoUrl ? { logoUrl } : { logoUrl: "" }),
        ...(primaryColor ? { primaryColor } : { primaryColor: "" }),
        ...(fontFamily ? { fontFamily } : { fontFamily: "" }),
        ...(successTitle ? { successTitle } : { successTitle: "" }),
        ...(successSubtitle ? { successSubtitle } : { successSubtitle: "" }),
        ...(successButtonText ? { successButtonText } : { successButtonText: "" }),
        ...(redirectUrl ? { redirectUrl } : { redirectUrl: "" }),
        ...(domainMode ? { domainMode } : { domainMode: "" }),
        ...(companyName ? { companyName } : { companyName: "" }),
        ...(customDomain ? { customDomain } : { customDomain: "" })
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
        requireAddress
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
        requireAddress
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
