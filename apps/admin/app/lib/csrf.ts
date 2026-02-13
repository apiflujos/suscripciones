import { cookies, headers } from "next/headers";

export const CSRF_COOKIE = "admin_csrf";

export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin || !host) return;
  try {
    const originHost = new URL(origin).host;
    if (originHost && originHost !== host) {
      throw new Error("csrf_blocked");
    }
  } catch (err) {
    throw new Error("csrf_blocked");
  }
}

export async function getCsrfToken() {
  const c = await cookies();
  return c.get(CSRF_COOKIE)?.value || "";
}

export async function assertCsrfToken(formData: FormData) {
  await assertSameOrigin();
  const token = String(formData.get("csrf") || "").trim();
  const c = await cookies();
  const cookieToken = String(c.get(CSRF_COOKIE)?.value || "").trim();
  if (!token || !cookieToken || token !== cookieToken) {
    throw new Error("csrf_invalid");
  }
}
