"use server";

import { cookies } from "next/headers";
import { assertCsrfToken } from "../../../lib/csrf";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
import { SA_COOKIE, adminFetchNoSa } from "../../saApi";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function saLogin(formData: FormData) {
  await assertCsrfToken(formData);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  try {
    const res = await adminFetchNoSa("/admin/sa/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) throw new Error(res.json?.error || `login_failed_${res.status}`);

    const token = String(res.json?.token || "").trim();
    if (!token) throw new Error("missing_token");
    const cookieStore = await cookies();
    cookieStore.set(SA_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production"
    });
    redirect("/sa");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    redirect(`/sa/login?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function saLogout() {
  const cookieStore = await cookies();
  cookieStore.delete(SA_COOKIE);
  redirect("/sa/login?loggedOut=1");
}
