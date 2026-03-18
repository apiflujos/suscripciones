"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";
import { createCampaign as createCampaignService, runCampaign as runCampaignService } from "../admin/_services/campaigns";

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

export async function createCampaign(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/campaigns").trim() || "/campaigns";
  const name = String(formData.get("name") || "").trim();
  const smartListId = String(formData.get("smartListId") || "").trim();
  const templateKind = String(formData.get("templateKind") || "MESSAGE").trim().toUpperCase();
  const templateName = String(formData.get("templateName") || "").trim();
  const contentRaw = String(formData.get("content") || "").trim();
  const content = templateKind === "WHATSAPP_TEMPLATE" ? (templateName || contentRaw || "Plantilla WhatsApp") : contentRaw;
  const templateParamsRaw = String(formData.get("templateParams") || "").trim();
  if (!name || !smartListId || !content) {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_required_fields`);
  }
  let templateParams: any = undefined;
  if (templateKind === "WHATSAPP_TEMPLATE") {
    const defaultTemplateParams = templateName
      ? { name: templateName, category: "UTILITY", language: "es", processed_params: { body: [] } }
      : undefined;
    if (templateParamsRaw) {
      try {
        templateParams = JSON.parse(templateParamsRaw);
      } catch {
        return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=invalid_template_params`);
      }
    } else {
      templateParams = defaultTemplateParams;
    }
  }

  try {
    const tenantId = await getSessionTenantId();
    const out = await createCampaignService({
      tenantId,
      input: {
        name,
        smartListId: smartListId || undefined,
        content,
        templateParams
      }
    });
    if (!out.ok) throw new Error(out.error || "create_failed");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}created=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function runCampaign(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = String(formData.get("returnTo") || "/campaigns").trim() || "/campaigns";
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_id`);
  try {
    const out = await runCampaignService(id);
    if (!out.ok) throw new Error(out.error || "run_failed");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}running=${encodeURIComponent(id)}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
