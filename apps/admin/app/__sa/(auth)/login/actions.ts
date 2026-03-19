"use server";

import { cookies } from "next/headers";
import { assertCsrfToken } from "../../../lib/csrf";
import { redirect } from "next/navigation";
import { SA_COOKIE, adminFetchNoSa } from "../../saApi";

function isRedirectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

export async function saLogin() {
  // Unificado: todos los accesos pasan por /login
  redirect("/login?next=%2Fsa");
}

export async function saLogout() {
  const cookieStore = await cookies();
  cookieStore.delete(SA_COOKIE);
  redirect("/login?loggedOut=1");
}
