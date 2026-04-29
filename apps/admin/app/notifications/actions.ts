"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import {
  getNotificationsConfigForEnv,
  type NotificationsConfig,
  type NotificationRule,
  type NotificationTemplate,
  notificationsConfigSchema,
  setNotificationsConfig
} from "@suscripciones/core/services/notificationsConfig";
import {
  REALTIME_NOTIFICATION_MAP,
  type RealtimeNotificationKey
} from "./realtimeDefinitions";

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function isNextRedirect(err: unknown) {
  const digest =
    err && typeof err === "object" && "digest" in err
      ? (err as { digest?: unknown }).digest
      : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

async function getNotificationsConfig(environment: "PRODUCTION" | "SANDBOX"): Promise<NotificationsConfig> {
  return await getNotificationsConfigForEnv(environment);
}

async function putNotificationsConfig(environment: "PRODUCTION" | "SANDBOX", config: NotificationsConfig) {
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
    redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=csrf_invalid`);
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
    redirect(`/settings?tab=notificaciones-whatsapp&env=${env}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/settings?tab=notificaciones-whatsapp&env=${env}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

function parseOffsetsCsv(raw: string, sign: 1 | -1) {
  const parts = String(raw || "")
    .split(",")
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return [sign * 60 * 60 * 24];
  return parts.map((n) => (sign === -1 ? -Math.abs(n) : Math.abs(n))).map((n) => Math.trunc(n));
}

function parsePipeParams(raw: string) {
  return String(raw || "")
    .split("|")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function buildProcessedParams(args: { bodyParams?: string[]; headerParams?: string[]; buttonParams?: string[] }) {
  const bodyParams = args.bodyParams?.filter(Boolean) || [];
  const headerParams = args.headerParams?.filter(Boolean) || [];
  const buttonParams = args.buttonParams?.filter(Boolean) || [];
  const out: Record<string, unknown> = {};
  if (bodyParams.length) out.body = bodyParams.map((v, idx) => ({ key: String(idx + 1), value: v }));
  if (headerParams.length) out.header = headerParams.map((v, idx) => ({ key: String(idx + 1), value: v }));
  if (buttonParams.length) out.buttons = buttonParams.map((v, idx) => ({ index: String(idx), value: v }));
  return Object.keys(out).length ? out : undefined;
}

function normalizeTemplatePayload(formData: FormData) {
  const templateKind = String(formData.get("templateKind") || "WHATSAPP_TEMPLATE").trim().toUpperCase();
  const waTemplateName = String(formData.get("waTemplateName") || "").trim();
  const waLanguage = String(formData.get("waLanguage") || "es").trim();
  const waParamsRaw = String(formData.get("waParams") || "").trim();
  const waBodyParamsRaw = String(formData.get("waBodyParams") || "").trim();
  const waHeaderParamsRaw = String(formData.get("waHeaderParams") || "").trim();
  const waButtonParamsRaw = String(formData.get("waButtonParams") || "").trim();
  const legacyBodyParams = waParamsRaw ? parsePipeParams(waParamsRaw) : [];
  const bodyParams = waBodyParamsRaw ? parsePipeParams(waBodyParamsRaw) : legacyBodyParams;
  const headerParams = waHeaderParamsRaw ? parsePipeParams(waHeaderParamsRaw) : [];
  const buttonParams = waButtonParamsRaw ? parsePipeParams(waButtonParamsRaw) : [];

  if (templateKind !== "WHATSAPP_TEMPLATE") throw new Error("invalid_template_kind");
  if (!waTemplateName || !waLanguage) throw new Error("missing_template_fields");
  return {
    kind: "WHATSAPP_TEMPLATE" as const,
    content: "(template)",
    chatwootTemplate: {
      name: waTemplateName,
      language: waLanguage,
      processed_params: buildProcessedParams({ bodyParams, headerParams, buttonParams })
    }
  };
}

function samePaymentType(rule: NotificationRule, paymentType?: string) {
  const types = rule?.conditions?.requirePaymentTypeIn;
  if (!paymentType) return !types || !types.length;
  return Array.isArray(types) && types.includes(paymentType);
}

function isUnifiedPaymentTrigger(trigger: string) {
  return trigger === "PAYMENT_APPROVED";
}

function shouldDisableRule(trigger: string, paymentType: string | undefined, rule: NotificationRule) {
  if (isUnifiedPaymentTrigger(trigger)) return String(rule?.trigger || "") === trigger;
  if (!paymentType || paymentType === "ANY") {
    return String(rule?.trigger || "") === trigger && (!rule?.conditions?.requirePaymentTypeIn || !rule.conditions.requirePaymentTypeIn.length);
  }
  return String(rule?.trigger || "") === trigger && Array.isArray(rule?.conditions?.requirePaymentTypeIn) && rule.conditions.requirePaymentTypeIn.includes(paymentType);
}

export async function saveRealtime(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const key = String(formData.get("key") || "").trim() as RealtimeNotificationKey;
  const meta = REALTIME_NOTIFICATION_MAP[key];
  if (!meta) return redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=invalid_key`);
  const enabled = String(formData.get("enabled") || "") === "on";

  try {
    const config = await getNotificationsConfig(environment);
    const baseConfig = config && typeof config === "object" ? config : { version: 1, templates: [], rules: [] };
    const templates: NotificationTemplate[] = baseConfig.templates.slice();
    const rules: NotificationRule[] = baseConfig.rules.slice();

    const templateId = `tpl_rt_${key}`;
    const tplPayload = normalizeTemplatePayload(formData);

    const nextTemplates = templates.filter((t) => String(t.id) !== templateId);
    nextTemplates.push({
      id: templateId,
      name: meta.label,
      channel: "CHATWOOT",
      chatwootType: meta.chatwootType,
      content: tplPayload.content,
      chatwootTemplate: tplPayload.chatwootTemplate
    });

    const ruleId = `rule_rt_${key}`;
    const nextRules = rules.filter((r) => {
      if (String(r.id) === ruleId) return false;
      if (r.trigger !== meta.trigger) return true;
      if (isUnifiedPaymentTrigger(meta.trigger) && !meta.paymentType) return false;
      return !samePaymentType(r, meta.paymentType);
    });

    const rule: NotificationRule = {
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
    redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&saved=1`);
  } catch (err) {
    redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function saveReminder(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const kind = String(formData.get("kind") || "").trim().toUpperCase();
  const paymentTypeRaw = String(formData.get("paymentType") || "").trim().toUpperCase();
  const paymentType = paymentTypeRaw === "SUBSCRIPTION" ? "SUBSCRIPTION" : "LINK";
  const enabled = String(formData.get("enabled") || "") === "on";
  const templateId = String(formData.get("templateId") || "").trim();
  if (!templateId) return redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=invalid_template`);
  const offsetsRaw = String(formData.get("offsetsSeconds") || "");
  const offsetsSeconds = parseOffsetsCsv(offsetsRaw, kind === "MORA" ? 1 : -1);

  try {
    const config = await getNotificationsConfig(environment);
    const baseConfig = config && typeof config === "object" ? config : { version: 1, templates: [], rules: [] };
    const templates: NotificationTemplate[] = baseConfig.templates.slice();
    const rules: NotificationRule[] = baseConfig.rules.slice();

    const tplPayload = normalizeTemplatePayload(formData);
    const tplNameBase = kind === "MORA" ? "Recordatorio en mora" : "Recordatorio de fecha de pago";
    const tplName = `${tplNameBase} (${paymentType === "SUBSCRIPTION" ? "débito automático" : "link de pago"})`;

    const nextTemplates = templates.filter((t) => String(t.id) !== templateId);
    nextTemplates.push({
      id: templateId,
      name: tplName,
      channel: "CHATWOOT",
      chatwootType: "EXPIRY_WARNING",
      content: tplPayload.content,
      chatwootTemplate: tplPayload.chatwootTemplate
    });

    const ruleIdBase = kind === "MORA" ? "rule_reminder_mora" : "rule_reminder_due";
    const ruleId = `${ruleIdBase}_${paymentType === "SUBSCRIPTION" ? "subscription" : "link"}`;
    const legacyRuleId = ruleIdBase;
    const nextRules = rules.filter((r) => {
      const id = String(r.id);
      return id !== ruleId && id !== legacyRuleId;
    });

    const rule: NotificationRule = {
      id: ruleId,
      name: tplName,
      enabled,
      trigger: "SUBSCRIPTION_DUE",
      templateId,
      offsetsSeconds,
      ensurePaymentLink: paymentType === "LINK",
      conditions: { skipIfSubscriptionStatusIn: ["CANCELED"], requirePaymentTypeIn: [paymentType] }
    };
    nextRules.push(rule);

    const next = { version: 1, ...(baseConfig || {}), templates: nextTemplates, rules: nextRules };
    await putNotificationsConfig(environment, next);
    redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&saved=1`);
  } catch (err) {
    redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function toggleRule(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  await requireCsrf(formData, environment);
  const ruleId = String(formData.get("ruleId") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  if (!ruleId) return redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=missing_rule_id`);
  try {
    const config = await getNotificationsConfig(environment);
    const rules: NotificationRule[] = config.rules.slice();
    const idx = rules.findIndex((r) => String(r.id) === ruleId);
    if (idx === -1) return redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=rule_not_found`);
    const trigger = String(rules[idx]?.trigger || "");
    if (enabled && trigger) {
      const paymentType = String(rules[idx]?.conditions?.requirePaymentTypeIn?.[0] || "ANY").trim().toUpperCase();
      for (let i = 0; i < rules.length; i++) {
        if (i !== idx && shouldDisableRule(trigger, paymentType, rules[i])) {
          rules[i] = { ...rules[i], enabled: false };
        }
      }
    }
    rules[idx] = { ...rules[idx], enabled };
    const next = { ...(config || {}), rules };
    await putNotificationsConfig(environment, next);
    redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&saved=1`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    redirect(`/settings?tab=notificaciones-whatsapp&env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
