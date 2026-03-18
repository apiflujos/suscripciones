"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "../../lib/session";
import { bootstrapSuperAdmin as bootstrapSuperAdminService, loginAdminUser } from "../admin/_services/adminAuth";

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

function isRedirectErrorLike(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  if (!("digest" in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;");
}

export async function adminLogin(formData: FormData) {
  await assertCsrfToken(formData);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const remember = String(formData.get("remember") || "").trim() === "1";

  const nextPath = safeNextPath(formData.get("next"));

  try {
    const res = await loginAdminUser({ email, password });
    if (!res.ok) {
      const msg = res.error === "unauthorized" ? "unauthorized" : res.error;
      throw new Error(msg);
    }

    const kind = String(res.kind || "").trim();
    const role = kind === "super_admin" ? "SUPER_ADMIN" : String((res as any)?.role || "").trim();
    const tenantId = (res as any)?.tenantId ?? null;
    const sessionEmail = String((res as any)?.email || email || "").trim();
    if (!sessionEmail || !role) throw new Error("invalid_login_response");

    const sessionToken = await signAdminSession({ email: sessionEmail, role: role as any, tenantId }, { ttlSeconds: remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12 });
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {})
    });

    const saToken = kind === "super_admin" ? String((res as any)?.saToken || "").trim() : "";
    if (saToken) {
      cookieStore.set("sa_session", saToken, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {})
      });
    }

    redirect(nextPath);
  } catch (err) {
    if (isRedirectErrorLike(err)) throw err;
    redirect(`/login?error=${encodeURIComponent(toShortErrorMessage(err))}&next=${encodeURIComponent(nextPath)}`);
  }
}

export async function bootstrapSuperAdmin(formData: FormData) {
  await assertCsrfToken(formData);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const nextPath = safeNextPath(formData.get("next"));

  try {
    const res = await bootstrapSuperAdminService({ email, password });
    if (!res.ok) throw new Error(String(res.error || "bootstrap_failed").trim());

    const saToken = String((res as any)?.token || "").trim();
    if (!saToken) throw new Error("missing_sa_token");

    const sessionToken = await signAdminSession({ email, role: "SUPER_ADMIN", tenantId: null }, { ttlSeconds: 60 * 60 * 12 });
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production"
    });
    cookieStore.set("sa_session", saToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production"
    });

    redirect(nextPath || "/sa");
  } catch (err) {
    if (isRedirectErrorLike(err)) throw err;
    redirect(`/login?error=${encodeURIComponent(toShortErrorMessage(err))}&next=${encodeURIComponent(nextPath || "/sa")}`);
  }
}
