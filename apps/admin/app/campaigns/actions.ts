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

/** Solo rutas internas de /campaigns (nunca `//otro-sitio` ni otra sección). */
function safeCampaignsPath(raw: unknown, fallback: string) {
  const value = String(raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (value === "/campaigns" || value.startsWith("/campaigns/") || value.startsWith("/campaigns?")) return value;
  return fallback;
}

/** Agrega o reemplaza parámetros en una ruta que puede traer ya su propia query. */
function withParams(path: string, params: Record<string, string>) {
  const url = new URL(path, "http://localhost");
  for (const key of ["created", "running", "error"]) url.searchParams.delete(key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

async function getSessionTenantId() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.tenantId || null;
}

export async function createCampaign(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeCampaignsPath(formData.get("returnTo"), "/campaigns");
  // Si falla, se vuelve al formulario (con el error a la vista) cuando lo envía.
  const errorTo = safeCampaignsPath(formData.get("errorTo"), returnTo);
  const name = String(formData.get("name") || "").trim();
  const smartViewId = String(formData.get("smartViewId") || "").trim();
  const templateKind = String(formData.get("templateKind") || "WHATSAPP_TEMPLATE").trim().toUpperCase();
  const contentRaw = String(formData.get("content") || "").trim();
  const waTemplateName = String(formData.get("waTemplateName") || "").trim();
  const waLanguage = String(formData.get("waLanguage") || "es").trim();
  const waBodyParamsRaw = String(formData.get("waBodyParams") || "").trim();
  const waHeaderParamsRaw = String(formData.get("waHeaderParams") || "").trim();
  const waButtonParamsRaw = String(formData.get("waButtonParams") || "").trim();
  if (!name || !smartViewId) {
    return redirect(withParams(errorTo, { error: "missing_required_fields" }));
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

  if (templateKind === "WHATSAPP_TEMPLATE") {
    if (!waTemplateName || !waLanguage) {
      return redirect(withParams(errorTo, { error: "missing_template_fields" }));
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
    return redirect(withParams(errorTo, { error: "invalid_template_kind" }));
  }

  try {
    const tenantId = await getSessionTenantId();
    const out = await createCampaignService({
      tenantId,
      input: {
        name,
        smartViewId: smartViewId || undefined,
        content,
        templateParams
      }
    });
    if (!out.ok) throw new Error(out.error || "create_failed");
    redirect(withParams(returnTo, { created: "1" }));
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(withParams(errorTo, { error: toShortErrorMessage(err) }));
  }
}

export async function runCampaign(formData: FormData) {
  await assertCsrfToken(formData);
  const returnTo = safeCampaignsPath(formData.get("returnTo"), "/campaigns");
  const errorTo = safeCampaignsPath(formData.get("errorTo"), returnTo);
  const id = String(formData.get("id") || "").trim();
  if (!id) return redirect(withParams(errorTo, { error: "missing_id" }));
  try {
    const out = await runCampaignService(id);
    if (!out.ok) throw new Error(out.error || "run_failed");
    redirect(withParams(returnTo, { running: id }));
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(withParams(errorTo, { error: toShortErrorMessage(err) }));
  }
}
