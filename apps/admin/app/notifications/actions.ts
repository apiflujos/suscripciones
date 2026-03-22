"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import {
  getNotificationsConfigForEnv,
  notificationsConfigSchema,
  setNotificationsConfig
} from "@suscripciones/core/services/notificationsConfig";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../lib/session";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest = (err as any)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

async function getNotificationsConfig(environment: "PRODUCTION" | "SANDBOX") {
  return (await getNotificationsConfigForEnv(environment)) as any;
}

async function putNotificationsConfig(environment: "PRODUCTION" | "SANDBOX", config: any) {
  const normalized = notificationsConfigSchema.parse(config);
  return setNotificationsConfig(normalized, { environment });
}

function normalizeEnv(value: unknown): "PRODUCTION" | "SANDBOX" {
  const v = String(value || "").trim().toUpperCase();
  return v === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}

async function requireCsrf(formData: FormData, environment: "PRODUCTION" | "SANDBOX") {
  try {
    await assertCsrfToken(formData);
  } catch {
    redirect(`/notifications?env=${environment}&error=csrf_invalid`);
  }
}

function slugifyId(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

async function getActorEmail() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.email || undefined;
}

function chatwootTypeForTrigger(trigger: string) {
  if (trigger === "SUBSCRIPTION_DUE") return "EXPIRY_WARNING";
  if (trigger === "PAYMENT_LINK_CREATED") return "PAYMENT_LINK";
  if (trigger === "CATALOG_LINK_CREATED") return "PAYMENT_LINK";
  if (trigger === "TOKENIZATION_LINK_CREATED") return "PAYMENT_LINK";
  if (trigger === "PAYMENT_APPROVED") return "PAYMENT_CONFIRMED";
  if (trigger === "PAYMENT_DECLINED") return "PAYMENT_FAILED";
  return "EXPIRY_WARNING";
}

function triggerLabel(trigger: string) {
  if (trigger === "SUBSCRIPTION_DUE") return "Recordatorio de pago";
  if (trigger === "PAYMENT_LINK_CREATED") return "Envío de link de pago";
  if (trigger === "CATALOG_LINK_CREATED") return "Envío de catálogo";
  if (trigger === "TOKENIZATION_LINK_CREATED") return "Envío de tokenización";
  if (trigger === "PAYMENT_APPROVED") return "Pago aprobado";
  if (trigger === "PAYMENT_DECLINED") return "Pago rechazado";
  return "Notificación";
}

function paymentTypeLabel(paymentType: string) {
  if (paymentType === "PLAN") return "Plan";
  if (paymentType === "SUBSCRIPTION") return "Suscripción";
  if (paymentType === "LINK") return "Link de pago";
  return "";
}

function formatOffsetName(offsetsSeconds: number[], atTimeUtc?: string) {
  if (!offsetsSeconds.length) return "inmediato";
  const parts = offsetsSeconds.map((sec) => {
    const s = Number(sec);
    if (!Number.isFinite(s) || s === 0) return "inmediato";
    const dir = s < 0 ? "antes" : "después";
    const abs = Math.abs(s);
    const minutes = Math.round(abs / 60);
    if (minutes < 60) return `${minutes} min ${dir}`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ${dir}`;
    const days = Math.round(hours / 24);
    return `${days} d ${dir}`;
  });
  const uniq = Array.from(new Set(parts));
  const base = uniq.join(", ");
  return atTimeUtc ? `${base} · ${atTimeUtc} UTC` : base;
}

function toOffsetsSeconds(formData: FormData) {
  const raw = formData.getAll("offsetSeconds");
  const offsets = raw
    .map((v) => Number(String(v)))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n as number));
  return offsets.length ? offsets : [0];
}

export async function createNotification(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const trigger = String(formData.get("trigger") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const templateKind = String(formData.get("templateKind") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const ensurePaymentLink = String(formData.get("ensurePaymentLink") || "").trim() === "1";
  const paymentType = String(formData.get("paymentType") || "ANY").trim().toUpperCase();
  const atTimeUtc = String(formData.get("atTimeUtc") || "").trim();

  const waTemplateName = String(formData.get("waTemplateName") || "").trim();
  const waLanguage = String(formData.get("waLanguage") || "").trim();
  const waParams = formData
    .getAll("waParam")
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const allowedTriggers = new Set([
    "SUBSCRIPTION_DUE",
    "PAYMENT_LINK_CREATED",
    "CATALOG_LINK_CREATED",
    "TOKENIZATION_LINK_CREATED",
    "PAYMENT_APPROVED",
    "PAYMENT_DECLINED"
  ]);
  if (!allowedTriggers.has(trigger)) return { ok: false, error: "invalid_trigger" };

  const offsetsSeconds = toOffsetsSeconds(formData);

  const isText = templateKind === "TEXT";
  const isWhatsAppTemplate = templateKind === "WHATSAPP_TEMPLATE";
  if (!isText && !isWhatsAppTemplate) return { ok: false, error: "invalid_template_kind" };

  if (isText && !message) return { ok: false, error: "missing_message" };
  if (isWhatsAppTemplate && (!waTemplateName || !waLanguage)) return { ok: false, error: "missing_template_fields" };

  const timeOk = !atTimeUtc || /^([01]\d|2[0-3]):[0-5]\d$/.test(atTimeUtc);
  if (!timeOk) return { ok: false, error: "invalid_time" };

  try {
    const config = await getNotificationsConfig(environment);
    const baseConfig = config && typeof config === "object" ? config : { version: 1, templates: [], rules: [] };
    const templates = Array.isArray(baseConfig?.templates) ? baseConfig.templates.slice() : [];
    const rules = Array.isArray(baseConfig?.rules) ? baseConfig.rules.slice() : [];

    const chatwootType = chatwootTypeForTrigger(trigger);
    const paymentSuffix = paymentType && paymentType !== "ANY" ? paymentTypeLabel(paymentType) : "Todos";
    const offsetName = formatOffsetName(offsetsSeconds, atTimeUtc);
    const baseName = title || `${triggerLabel(trigger)} · ${offsetName} · ${paymentSuffix}`;

    const base = slugifyId(baseName) || "notif";
    let templateId = `tpl_${base}`;
    let i = 2;
    while (templates.some((t: any) => String(t.id) === templateId)) templateId = `tpl_${base}_${i++}`;

    const template: any = {
      id: templateId,
      name: baseName,
      channel: "CHATWOOT",
      chatwootType
    };

    if (isText) {
      template.content = message;
    } else {
      template.content = "(template)";
      template.chatwootTemplate = {
        name: waTemplateName,
        language: waLanguage,
        processed_params: waParams.length ? { body: waParams.map((v, idx) => ({ key: String(idx + 1), value: v })) } : undefined
      };
    }

    templates.push(template);

    const ruleId = `rule_${Date.now()}`;
    const rule: any = {
      id: ruleId,
      name: baseName,
      enabled: true,
      trigger,
      templateId,
      offsetsSeconds,
      ...(atTimeUtc ? { atTimeUtc } : {})
    };
    if (trigger === "SUBSCRIPTION_DUE") {
      rule.ensurePaymentLink = ensurePaymentLink;
      rule.conditions = { skipIfSubscriptionStatusIn: ["CANCELED"] };
    }
    if (paymentType && paymentType !== "ANY") {
      rule.conditions = { ...(rule.conditions || {}), requirePaymentTypeIn: [paymentType] };
    }
    rules.push(rule);

    const next = { version: 1, ...(baseConfig || {}), templates, rules };
    await putNotificationsConfig(environment, next);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: toShortErrorMessage(err) };
  }
}

export async function saveNotificationsConfig(formData: FormData) {
  const environment = String(formData.get("environment") || "").trim().toUpperCase();
  const env = environment === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  await requireCsrf(formData, env);
  const raw = String(formData.get("configJson") || "").trim();

  try {
    const parsed = raw ? JSON.parse(raw) : null;
    await putNotificationsConfig(env, parsed);
    redirect(`/notifications?env=${env}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${env}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

type RuleTrigger = "SUBSCRIPTION_DUE" | "PAYMENT_LINK_CREATED" | "CATALOG_LINK_CREATED" | "TOKENIZATION_LINK_CREATED" | "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
type ChatwootType = "PAYMENT_LINK" | "PAYMENT_CONFIRMED" | "EXPIRY_WARNING" | "PAYMENT_FAILED";

const REALTIME_MAP: Record<string, { trigger: RuleTrigger; chatwootType: ChatwootType; paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK"; label: string }> = {
  payment_link_created: { trigger: "PAYMENT_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "LINK", label: "Link de pago creado" },
  catalog_link_created_plan: { trigger: "CATALOG_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "PLAN", label: "Catálogo enviado (plan)" },
  catalog_link_created_subscription: { trigger: "CATALOG_LINK_CREATED", chatwootType: "PAYMENT_LINK", paymentType: "SUBSCRIPTION", label: "Catálogo enviado (suscripción · link de pago)" },
  tokenization_link_created: { trigger: "TOKENIZATION_LINK_CREATED", chatwootType: "PAYMENT_LINK", label: "Tokenización enviada (débito automático)" },
  payment_success_subscription: { trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "SUBSCRIPTION", label: "Pago exitoso (débito automático)" },
  payment_success_plan: { trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "PLAN", label: "Pago exitoso (plan)" },
  payment_success_link: { trigger: "PAYMENT_APPROVED", chatwootType: "PAYMENT_CONFIRMED", paymentType: "LINK", label: "Pago recibido por link de pago" },
  payment_failed_subscription: { trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "SUBSCRIPTION", label: "Pago fallido (débito automático)" },
  payment_failed_plan: { trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "PLAN", label: "Pago fallido (plan)" },
  payment_failed_link: { trigger: "PAYMENT_DECLINED", chatwootType: "PAYMENT_FAILED", paymentType: "LINK", label: "Pago fallido (link de pago)" }
};

function parseOffsetsCsv(raw: string, sign: 1 | -1) {
  const parts = String(raw || "")
    .split(",")
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return [sign * 60 * 60 * 24];
  return parts.map((n) => (sign === -1 ? -Math.abs(n) : Math.abs(n))).map((n) => Math.trunc(n));
}

function normalizeTemplatePayload(formData: FormData) {
  const templateKind = String(formData.get("templateKind") || "TEXT").trim().toUpperCase();
  const content = String(formData.get("content") || "").trim();
  const waTemplateName = String(formData.get("waTemplateName") || "").trim();
  const waLanguage = String(formData.get("waLanguage") || "es").trim();
  const waParamsRaw = String(formData.get("waParams") || "").trim();
  const waParams = waParamsRaw ? waParamsRaw.split("|").map((v) => v.trim()).filter(Boolean) : [];

  if (templateKind === "TEXT") {
    if (!content) throw new Error("missing_message");
    return { kind: "TEXT" as const, content };
  }
  if (!waTemplateName || !waLanguage) throw new Error("missing_template_fields");
  return {
    kind: "WHATSAPP_TEMPLATE" as const,
    content: "(template)",
    chatwootTemplate: {
      name: waTemplateName,
      language: waLanguage,
      processed_params: waParams.length ? { body: waParams.map((v, idx) => ({ key: String(idx + 1), value: v })) } : undefined
    }
  };
}

function samePaymentType(rule: any, paymentType?: string) {
  const types = rule?.conditions?.requirePaymentTypeIn;
  if (!paymentType) return !types || !types.length;
  return Array.isArray(types) && types.includes(paymentType);
}

export async function saveRealtime(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const key = String(formData.get("key") || "").trim();
  const meta = REALTIME_MAP[key];
  if (!meta) return redirect(`/notifications?env=${environment}&error=invalid_key`);
  const enabled = String(formData.get("enabled") || "") === "on";

  try {
    const config = await getNotificationsConfig(environment);
    const baseConfig = config && typeof config === "object" ? config : { version: 1, templates: [], rules: [] };
    const templates = Array.isArray(baseConfig?.templates) ? baseConfig.templates.slice() : [];
    const rules = Array.isArray(baseConfig?.rules) ? baseConfig.rules.slice() : [];

    const templateId = `tpl_rt_${key}`;
    const tplPayload = normalizeTemplatePayload(formData);

    const nextTemplates = templates.filter((t: any) => String(t.id) !== templateId);
    nextTemplates.push({
      id: templateId,
      name: meta.label,
      channel: "CHATWOOT",
      chatwootType: meta.chatwootType,
      ...(tplPayload.kind === "TEXT" ? { content: tplPayload.content } : { content: tplPayload.content, chatwootTemplate: tplPayload.chatwootTemplate })
    });

    const ruleId = `rule_rt_${key}`;
    const nextRules = rules.filter((r: any) => {
      if (String(r.id) === ruleId) return false;
      if (r.trigger !== meta.trigger) return true;
      return !samePaymentType(r, meta.paymentType);
    });

    const rule: any = {
      id: ruleId,
      name: meta.label,
      enabled,
      trigger: meta.trigger,
      templateId,
      offsetsSeconds: [0]
    };
    if (meta.paymentType) rule.conditions = { requirePaymentTypeIn: [meta.paymentType] };
    nextRules.push(rule);

    const next = { version: 1, ...(baseConfig || {}), templates: nextTemplates, rules: nextRules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err: any) {
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function saveReminder(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const kind = String(formData.get("kind") || "").trim().toUpperCase();
  const enabled = String(formData.get("enabled") || "") === "on";
  const templateId = String(formData.get("templateId") || "").trim();
  if (!templateId) return redirect(`/notifications?env=${environment}&error=invalid_template`);
  const offsetsRaw = String(formData.get("offsetsSeconds") || "");
  const offsetsSeconds = parseOffsetsCsv(offsetsRaw, kind === "MORA" ? 1 : -1);

  try {
    const config = await getNotificationsConfig(environment);
    const baseConfig = config && typeof config === "object" ? config : { version: 1, templates: [], rules: [] };
    const templates = Array.isArray(baseConfig?.templates) ? baseConfig.templates.slice() : [];
    const rules = Array.isArray(baseConfig?.rules) ? baseConfig.rules.slice() : [];

    const tplPayload = normalizeTemplatePayload(formData);
    const tplName = kind === "MORA" ? "Recordatorio en mora" : "Recordatorio de fecha de pago";

    const nextTemplates = templates.filter((t: any) => String(t.id) !== templateId);
    nextTemplates.push({
      id: templateId,
      name: tplName,
      channel: "CHATWOOT",
      chatwootType: "EXPIRY_WARNING",
      ...(tplPayload.kind === "TEXT" ? { content: tplPayload.content } : { content: tplPayload.content, chatwootTemplate: tplPayload.chatwootTemplate })
    });

    const ruleId = kind === "MORA" ? "rule_reminder_mora" : "rule_reminder_due";
    const nextRules = rules.filter((r: any) => String(r.id) !== ruleId);

    const rule: any = {
      id: ruleId,
      name: tplName,
      enabled,
      trigger: "SUBSCRIPTION_DUE",
      templateId,
      offsetsSeconds,
      ensurePaymentLink: true,
      conditions: { skipIfSubscriptionStatusIn: ["CANCELED"] }
    };
    nextRules.push(rule);

    const next = { version: 1, ...(baseConfig || {}), templates: nextTemplates, rules: nextRules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err: any) {
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function addTextTemplate(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const name = String(formData.get("name") || "").trim();
  const chatwootType = String(formData.get("chatwootType") || "").trim();
  const content = String(formData.get("content") || "").trim();
  if (!name || !chatwootType || !content) return redirect(`/notifications?env=${environment}&error=missing_fields`);

  try {
    const config = await getNotificationsConfig(environment);
    const templates = Array.isArray(config?.templates) ? config.templates.slice() : [];
    const base = slugifyId(name) || "template";
    let id = `tpl_${base}`;
    let i = 2;
    while (templates.some((t: any) => String(t.id) === id)) {
      id = `tpl_${base}_${i++}`;
    }
    templates.push({
      id,
      name,
      channel: "CHATWOOT",
      chatwootType,
      content
    });
    const next = { ...(config || {}), templates };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function addWhatsAppTemplate(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const name = String(formData.get("name") || "").trim();
  const chatwootType = String(formData.get("chatwootType") || "").trim();
  const templateName = String(formData.get("templateName") || "").trim();
  const language = String(formData.get("language") || "").trim();
  const bodyParams = Array.from({ length: 10 })
    .map((_, idx) => String(formData.get(`bodyParam${idx + 1}`) || "").trim())
    .filter(Boolean);

  if (!name || !chatwootType || !templateName || !language) return redirect(`/notifications?env=${environment}&error=missing_fields`);

  try {
    const config = await getNotificationsConfig(environment);
    const templates = Array.isArray(config?.templates) ? config.templates.slice() : [];
    const base = slugifyId(name) || "template";
    let id = `tpl_${base}`;
    let i = 2;
    while (templates.some((t: any) => String(t.id) === id)) {
      id = `tpl_${base}_${i++}`;
    }
    templates.push({
      id,
      name,
      channel: "CHATWOOT",
      chatwootType,
      chatwootTemplate: {
        name: templateName,
        language,
        processed_params: bodyParams.length ? { body: bodyParams.map((v, idx) => ({ key: String(idx + 1), value: v })) } : undefined
      }
    });
    const next = { ...(config || {}), templates };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function deleteTemplate(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const templateId = String(formData.get("templateId") || "").trim();
  if (!templateId) return redirect(`/notifications?env=${environment}&error=missing_template_id`);
  try {
    const config = await getNotificationsConfig(environment);
    const templates = Array.isArray(config?.templates) ? config.templates.filter((t: any) => String(t.id) !== templateId) : [];
    const rules = Array.isArray(config?.rules) ? config.rules.filter((r: any) => String(r.templateId) !== templateId) : [];
    const next = { ...(config || {}), templates, rules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

function offsetSecondsFromForm(formData: FormData) {
  const dir = String(formData.get("direction") || "after").trim();
  const amount = Number(String(formData.get("amount") || "0").trim());
  const unit = String(formData.get("unit") || "minutes").trim();
  const baseSeconds =
    unit === "seconds" ? amount :
    unit === "minutes" ? amount * 60 :
    unit === "hours" ? amount * 60 * 60 :
    unit === "days" ? amount * 24 * 60 * 60 :
    amount * 60;
  const signed = dir === "before" ? -baseSeconds : baseSeconds;
  if (!Number.isFinite(signed)) return 0;
  return Math.trunc(signed);
}

export async function addRule(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const name = String(formData.get("name") || "").trim();
  const trigger = String(formData.get("trigger") || "").trim();
  const templateId = String(formData.get("templateId") || "").trim();
  const ensurePaymentLink = String(formData.get("ensurePaymentLink") || "").trim() === "1";
  const enabled = String(formData.get("enabled") || "").trim() !== "0";
  const offsetSeconds = offsetSecondsFromForm(formData);
  if (!name || !trigger || !templateId) return redirect(`/notifications?env=${environment}&error=missing_fields`);

  try {
    const config = await getNotificationsConfig(environment);
    const rules = Array.isArray(config?.rules) ? config.rules.slice() : [];
    const id = `rule_${Date.now()}`;
    const normalizedTrigger = String(trigger || "").trim();
    if (enabled && normalizedTrigger) {
      for (let i = 0; i < rules.length; i++) {
        if (String(rules[i]?.trigger || "") === normalizedTrigger) {
          rules[i] = { ...rules[i], enabled: false };
        }
      }
    }
    rules.push({
      id,
      name,
      enabled,
      trigger,
      templateId,
      offsetsSeconds: [offsetSeconds],
      ...(trigger === "SUBSCRIPTION_DUE" ? { ensurePaymentLink, conditions: { skipIfSubscriptionStatusIn: ["CANCELED"] } } : {})
    });
    const next = { ...(config || {}), rules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function toggleRule(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const ruleId = String(formData.get("ruleId") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  if (!ruleId) return redirect(`/notifications?env=${environment}&error=missing_rule_id`);
  try {
    const config = await getNotificationsConfig(environment);
    const rules = Array.isArray(config?.rules) ? config.rules.slice() : [];
    const idx = rules.findIndex((r: any) => String(r.id) === ruleId);
    if (idx === -1) return redirect(`/notifications?env=${environment}&error=rule_not_found`);
    const trigger = String(rules[idx]?.trigger || "");
    if (enabled && trigger) {
      for (let i = 0; i < rules.length; i++) {
        if (i !== idx && String(rules[i]?.trigger || "") === trigger) {
          rules[i] = { ...rules[i], enabled: false };
        }
      }
    }
    rules[idx] = { ...rules[idx], enabled };
    const next = { ...(config || {}), rules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function deleteRule(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const ruleId = String(formData.get("ruleId") || "").trim();
  if (!ruleId) return redirect(`/notifications?env=${environment}&error=missing_rule_id`);
  try {
    const config = await getNotificationsConfig(environment);
    const rules = Array.isArray(config?.rules) ? config.rules.filter((r: any) => String(r.id) !== ruleId) : [];
    const next = { ...(config || {}), rules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function updateTemplate(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const templateId = String(formData.get("templateId") || "").trim();
  if (!templateId) return redirect(`/notifications?env=${environment}&error=missing_template_id`);

  const name = String(formData.get("name") || "").trim();
  const channel = String(formData.get("channel") || "CHATWOOT").trim().toUpperCase();
  const chatwootType = String(formData.get("chatwootType") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const waTemplateName = String(formData.get("waTemplateName") || "").trim();
  const waLanguage = String(formData.get("waLanguage") || "").trim();
  const waParamsRaw = String(formData.get("waParams") || "").trim();
  const waParams = waParamsRaw ? waParamsRaw.split("|").map((v) => v.trim()).filter(Boolean) : [];
  const metaTemplateName = String(formData.get("metaTemplateName") || "").trim();
  const metaLanguage = String(formData.get("metaLanguage") || "").trim();
  const metaComponentsRaw = String(formData.get("metaComponents") || "").trim();

  if (!name) return redirect(`/notifications?env=${environment}&error=missing_name`);

  try {
    const config = await getNotificationsConfig(environment);
    const templates = Array.isArray(config?.templates) ? config.templates.slice() : [];
    const idx = templates.findIndex((t: any) => String(t.id) === templateId);
    if (idx === -1) return redirect(`/notifications?env=${environment}&error=template_not_found`);

    const next: any = { ...templates[idx] };
    next.name = name;
    next.channel = channel === "META" ? "META" : "CHATWOOT";

    if (next.channel === "META") {
      if (!metaTemplateName || !metaLanguage) {
        return redirect(`/notifications?env=${environment}&error=missing_meta_fields`);
      }
      let components: any = undefined;
      if (metaComponentsRaw) {
        try {
          components = JSON.parse(metaComponentsRaw);
        } catch {
          return redirect(`/notifications?env=${environment}&error=invalid_meta_components`);
        }
      }
      next.meta = {
        templateName: metaTemplateName,
        language: metaLanguage,
        components
      };
      next.chatwootType = undefined;
      next.content = undefined;
      next.chatwootTemplate = undefined;
    } else {
      next.chatwootType = chatwootType || next.chatwootType || "PAYMENT_LINK";
      if (waTemplateName) {
        next.content = "(template)";
        next.chatwootTemplate = {
          name: waTemplateName,
          language: waLanguage || "es",
          processed_params: waParams.length ? { body: waParams.map((v, idx2) => ({ key: String(idx2 + 1), value: v })) } : undefined
        };
      } else {
        if (!content) {
          return redirect(`/notifications?env=${environment}&error=missing_message`);
        }
        next.content = content;
        next.chatwootTemplate = undefined;
      }
      next.meta = undefined;
    }

    templates[idx] = next;
    const updated = { ...(config || {}), templates };
    await putNotificationsConfig(environment, updated);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function updateRule(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const ruleId = String(formData.get("ruleId") || "").trim();
  if (!ruleId) return redirect(`/notifications?env=${environment}&error=missing_rule_id`);

  const name = String(formData.get("name") || "").trim();
  const trigger = String(formData.get("trigger") || "").trim();
  const templateId = String(formData.get("templateId") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  const paymentType = String(formData.get("paymentType") || "ANY").trim().toUpperCase();
  const ensurePaymentLink = String(formData.get("ensurePaymentLink") || "").trim() === "1";
  const atTimeUtc = String(formData.get("atTimeUtc") || "").trim();
  const offsetsSeconds = toOffsetsSeconds(formData);

  if (!name || !trigger || !templateId) return redirect(`/notifications?env=${environment}&error=missing_fields`);

  try {
    const config = await getNotificationsConfig(environment);
    const rules = Array.isArray(config?.rules) ? config.rules.slice() : [];
    const idx = rules.findIndex((r: any) => String(r.id) === ruleId);
    if (idx === -1) return redirect(`/notifications?env=${environment}&error=rule_not_found`);

    const next: any = { ...rules[idx] };
    next.name = name;
    next.trigger = trigger;
    next.templateId = templateId;
    next.enabled = enabled;
    next.offsetsSeconds = offsetsSeconds;
    next.atTimeUtc = atTimeUtc || undefined;
    if (trigger === "SUBSCRIPTION_DUE") {
      next.ensurePaymentLink = ensurePaymentLink;
      next.conditions = { ...(next.conditions || {}), skipIfSubscriptionStatusIn: ["CANCELED"] };
    }
    if (paymentType && paymentType !== "ANY") {
      next.conditions = { ...(next.conditions || {}), requirePaymentTypeIn: [paymentType] };
    } else if (next.conditions) {
      const { requirePaymentTypeIn, ...rest } = next.conditions;
      next.conditions = Object.keys(rest).length ? rest : undefined;
    }

    if (enabled && trigger) {
      for (let i = 0; i < rules.length; i++) {
        if (i !== idx && String(rules[i]?.trigger || "") === String(trigger)) {
          rules[i] = { ...rules[i], enabled: false };
        }
      }
    }
    rules[idx] = next;
    const updated = { ...(config || {}), rules };
    await putNotificationsConfig(environment, updated);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function scheduleSubscription(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const forceNow = String(formData.get("forceNow") || "").trim() === "1";
  if (!subscriptionId) return redirect(`/notifications?env=${environment}&error=missing_subscription_id`);

  try {
    const actor = await getActorEmail();
    const result = await scheduleSubscriptionDueNotifications({ subscriptionId, forceNow, actor });
    redirect(`/notifications?env=${environment}&scheduled=${encodeURIComponent(String(result?.scheduled ?? 0))}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
