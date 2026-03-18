"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { createSmartList as createSmartListService, syncSmartList as syncSmartListService } from "../admin/_services/smartLists";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/\s+/g, " ").trim();
  return msg || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

async function getSessionTenantId() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.tenantId || null;
}

export async function createSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/smart-lists").trim() || "/smart-lists";
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const rulesRaw = String(formData.get("rules") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  let rules: any = { op: "and", rules: [] };
  try {
    rules = rulesRaw ? JSON.parse(rulesRaw) : { op: "and", rules: [] };
  } catch {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=invalid_rules_json`);
  }

  try {
    const tenantId = await getSessionTenantId();
    const out = await createSmartListService({ tenantId, name, description, rules, enabled });
    if (!out.ok) throw new Error(out.error || "create_failed");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}created=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function previewSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/smart-lists").trim() || "/smart-lists";
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_id`);
  redirect(`/smart-lists?preview=${encodeURIComponent(id)}`);
}

export async function syncSmartList(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/smart-lists").trim() || "/smart-lists";
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_id`);

  try {
    const out = await syncSmartListService({ id });
    if (!out.ok) throw new Error(out.error || "sync_failed");
    const msg = `agregados:${out.added ?? 0},removidos:${out.removed ?? 0}`;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}synced=${encodeURIComponent(msg)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
