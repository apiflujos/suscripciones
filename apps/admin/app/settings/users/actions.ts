"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../../lib/csrf";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import { createAdminUser } from "../../admin/_services/adminUsers";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function createUser(formData: FormData) {
  await assertCsrfToken(formData);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "").trim();
  const active = String(formData.get("active") || "").trim() === "1";
  const tenantIds = formData
    .getAll("tenantIds")
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  try {
    const c = await cookies();
    const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
    const session = await verifyAdminSessionToken(sessionToken);
    const res = await createAdminUser(session, { email, password, role, active, tenantIds });
    if (!res.ok) throw new Error(res.error || "request_failed");
    redirect(`/settings/users?created=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/settings/users?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
