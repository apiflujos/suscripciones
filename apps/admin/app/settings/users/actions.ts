"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../../lib/csrf";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";
import {
  createAdminUser,
  deleteAdminUser,
  updateAdminUser,
  updateAdminUserPassword
} from "../../admin/_services/adminUsers";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function buildReturnTo(formData: FormData) {
  const fallback = "/settings/users";
  const raw = String(formData.get("returnTo") || "").trim();
  return raw.startsWith("/") ? raw : fallback;
}

function withFlag(path: string, key: string, value: string) {
  const url = new URL(path, "http://localhost");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

async function getSession() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  return verifyAdminSessionToken(sessionToken);
}

export async function createUser(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = buildReturnTo(formData);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "").trim();
  const active = String(formData.get("active") || "").trim() === "1";
  const tenantIds = formData
    .getAll("tenantIds")
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  try {
    const session = await getSession();
    const res = await createAdminUser(session, { email, password, role, active, tenantIds });
    if (!res.ok) throw new Error(res.error || "request_failed");
    redirect(withFlag(returnTo, "created", "1"));
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(withFlag(returnTo, "error", toShortErrorMessage(err)));
  }
}

export async function updateUser(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = buildReturnTo(formData);
  const userId = String(formData.get("userId") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const role = String(formData.get("role") || "").trim();
  const active = String(formData.get("active") || "").trim() === "1";
  const tenantIds = formData
    .getAll("tenantIds")
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  try {
    const session = await getSession();
    const res = await updateAdminUser(session, { userId, email, role, active, tenantIds });
    if (!res.ok) throw new Error(res.error || "request_failed");
    redirect(withFlag(returnTo, "updated", "1"));
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(withFlag(returnTo, "error", toShortErrorMessage(err)));
  }
}

export async function changeUserPassword(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = buildReturnTo(formData);
  const userId = String(formData.get("userId") || "").trim();
  const password = String(formData.get("password") || "");

  try {
    const session = await getSession();
    const res = await updateAdminUserPassword(session, { userId, password });
    if (!res.ok) throw new Error(res.error || "request_failed");
    redirect(withFlag(returnTo, "passwordUpdated", "1"));
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(withFlag(returnTo, "error", toShortErrorMessage(err)));
  }
}

export async function deleteUser(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = buildReturnTo(formData);
  const userId = String(formData.get("userId") || "").trim();

  try {
    const session = await getSession();
    const res = await deleteAdminUser(session, { userId });
    if (!res.ok) throw new Error(res.error || "request_failed");
    redirect(withFlag(returnTo, "deleted", "1"));
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(withFlag(returnTo, "error", toShortErrorMessage(err)));
  }
}
