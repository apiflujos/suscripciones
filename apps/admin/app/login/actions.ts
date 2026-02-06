"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, computeAdminSessionToken, getAdminBasicCredentials } from "../../lib/authSession";

function safeNextPath(value: unknown) {
  const v = String(value || "").trim();
  if (!v) return "/";
  if (!v.startsWith("/")) return "/";
  if (v.startsWith("//")) return "/";
  return v;
}

export async function adminLogin(formData: FormData) {
  const { user: expectedUser, pass: expectedPass } = getAdminBasicCredentials();
  if (!expectedUser || !expectedPass) redirect("/?error=admin_basic_not_configured");

  const user = String(formData.get("user") || "").trim();
  const pass = String(formData.get("pass") || "");

  if (user !== expectedUser || pass !== expectedPass) {
    redirect("/login?error=invalid_credentials");
  }

  const token = await computeAdminSessionToken();
  cookies().set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14
  });

  const nextPath = safeNextPath(formData.get("next"));
  redirect(nextPath);
}

