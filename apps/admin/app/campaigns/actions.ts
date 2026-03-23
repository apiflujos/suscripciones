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
  const templateKind = String(formData.get("templateKind") || "TEXT").trim().toUpperCase();
  const contentRaw = String(formData.get("content") || "").trim();
  const waTemplateName = String(formData.get("waTemplateName") || "").trim();
  const waLanguage = String(formData.get("waLanguage") || "es").trim();
  const waBodyParamsRaw = String(formData.get("waBodyParams") || "").trim();
  const waHeaderParamsRaw = String(formData.get("waHeaderParams") || "").trim();
  const waButtonParamsRaw = String(formData.get("waButtonParams") || "").trim();
  if (!name || !smartListId) {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_required_fields`);
  }
  let content = contentRaw;
  let templateParams: any = undefined;

  const parsePipeParams = (raw: string) =>
    String(raw || "")
      .split("|")
      .map((v) => String(v || "").trim())
      .filter(Boolean);

  const buildProcessedParams = (args: { bodyParams?: string[]; headerParams?: string[]; buttonParams?: string[] }) => {
    const bodyParams = args.bodyParams?.filter(Boolean) || [];
    const headerParams = args.headerParams?.filter(Boolean) || [];
    const buttonParams = args.buttonParams?.filter(Boolean) || [];
    const out: Record<string, any> = {};
    if (bodyParams.length) out.body = bodyParams.map((v, idx) => ({ key: String(idx + 1), value: v }));
    if (headerParams.length) out.header = headerParams.map((v, idx) => ({ key: String(idx + 1), value: v }));
    if (buttonParams.length) out.buttons = buttonParams.map((v, idx) => ({ index: String(idx), value: v }));
    return Object.keys(out).length ? out : undefined;
  };

  if (templateKind === "TEXT") {
    if (!content) {
      return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_message`);
    }
  } else if (templateKind === "WHATSAPP_TEMPLATE") {
    if (!waTemplateName || !waLanguage) {
      return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_template_fields`);
    }
    content = contentRaw || `Plantilla WhatsApp: ${waTemplateName}`;
    templateParams = {
      name: waTemplateName,
      language: waLanguage,
      processed_params: buildProcessedParams({
        bodyParams: parsePipeParams(waBodyParamsRaw),
        headerParams: parsePipeParams(waHeaderParamsRaw),
        buttonParams: parsePipeParams(waButtonParamsRaw)
      })
    };
  } else {
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=invalid_template_kind`);
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
