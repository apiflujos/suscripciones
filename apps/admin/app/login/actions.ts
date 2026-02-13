"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
import { getAdminApiConfig } from "../lib/adminApi";
import { assertSameOrigin } from "../lib/csrf";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "../../lib/session";

function safeNextPath(value: unknown) {
  const v = String(value || "").trim();
  if (!v) return "/";
  if (!v.startsWith("/")) return "/";
  if (v.startsWith("//")) return "/";
  return v;
}

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/\s+/g, " ").trim();
  if (!msg) return "unknown_error";

  const lower = msg.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("socket") ||
    lower.includes("network")
  ) {
    return "api_unreachable";
  }

  return msg.slice(0, 220);
}

export async function adminLogin(formData: FormData) {
  assertSameOrigin();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const remember = String(formData.get("remember") || "").trim() === "1";

  const nextPath = safeNextPath(formData.get("next"));

  try {
    const { apiBase, token } = getAdminApiConfig();
    if (!token) throw new Error("missing_admin_token");

    const res = await fetch(`${apiBase}/admin/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-admin-token": token
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store"
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const apiErr = String(json?.error || "").trim();
      const apiReason = String(json?.reason || "").trim();
      if (res.status === 401 && apiErr === "unauthorized" && apiReason) throw new Error(`admin_api_${apiReason}`);
      throw new Error(apiErr || `login_failed_${res.status}`);
    }

    const kind = String(json?.kind || "").trim();
    const role = kind === "super_admin" ? "SUPER_ADMIN" : String(json?.role || "").trim();
    const tenantId = json?.tenantId ?? null;
    const sessionEmail = String(json?.email || email || "").trim();
    if (!sessionEmail || !role) throw new Error("invalid_login_response");

    const sessionToken = await signAdminSession({ email: sessionEmail, role: role as any, tenantId }, { ttlSeconds: remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12 });
    cookies().set(ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {})
    });

    const saToken = kind === "super_admin" ? String(json?.saToken || "").trim() : "";
    if (saToken) {
      cookies().set("sa_session", saToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {})
      });
    }

    redirect(nextPath);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(`/login?error=${encodeURIComponent(toShortErrorMessage(err))}&next=${encodeURIComponent(nextPath)}`);
  }
}

export async function bootstrapSuperAdmin(formData: FormData) {
  assertSameOrigin();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const nextPath = safeNextPath(formData.get("next"));

  try {
    const { apiBase, token } = getAdminApiConfig();
    if (!token) throw new Error("missing_admin_token");

    const res = await fetch(`${apiBase}/admin/sa/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-admin-token": token
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store"
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(String(json?.error || `bootstrap_failed_${res.status}`).trim());

    const saToken = String(json?.token || "").trim();
    if (!saToken) throw new Error("missing_sa_token");

    const sessionToken = await signAdminSession({ email, role: "SUPER_ADMIN", tenantId: null }, { ttlSeconds: 60 * 60 * 12 });
    cookies().set(ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production"
    });
    cookies().set("sa_session", saToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production"
    });

    redirect(nextPath || "/sa");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(`/login?error=${encodeURIComponent(toShortErrorMessage(err))}&next=${encodeURIComponent(nextPath || "/sa")}`);
  }
}
