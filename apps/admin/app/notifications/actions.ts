"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../lib/csrf";
import {
  getNotificationsConfigForEnv,
  type NotificationsConfig,
  type NotificationPaymentType,
  type NotificationRule,
  type NotificationTemplate,
  notificationsConfigSchema,
  setNotificationsConfig
} from "@suscripciones/core/services/notificationsConfig";
import {
  REALTIME_NOTIFICATION_MAP,
  type RealtimeNotificationKey
} from "./realtimeDefinitions";
import { getAllowedTemplateValues } from "./templateVariableMatrix";
import { ChatwootClient } from "@suscripciones/core/providers/chatwoot/client";
import { normalizeProcessedTemplateParams } from "@suscripciones/core/services/chatwootTemplates";
import { getChatwootConfig } from "@suscripciones/core/services/runtimeConfig";

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

function buttonRequiresParameter(button: any) {
  const hasPlaceholder = countPlaceholderSlotsFromText(button?.url) > 0;
  const hasExample = countPlaceholderSlotsFromExample(button?.example) > 0;
  return hasPlaceholder || hasExample;
}

function buildProcessedParams(args: {
  bodyParams?: string[];
  headerParams?: string[];
  buttonParams?: string[];
  components?: any[];
}) {
  const bodyParams = args.bodyParams?.filter(Boolean) || [];
  const headerParams = args.headerParams?.filter(Boolean) || [];
  const buttonParams = args.buttonParams?.filter(Boolean) || [];
  const out: Record<string, unknown> = {};
  if (bodyParams.length) {
    out.body = Object.fromEntries(bodyParams.map((value, idx) => [String(idx + 1), value]));
  }
  if (headerParams.length) {
    out.header = Object.fromEntries(headerParams.map((value, idx) => [String(idx + 1), value]));
  }
  if (buttonParams.length) {
    const buttonBlock = Array.isArray(args.components)
      ? args.components.find((component: any) => String(component?.type || "").toUpperCase() === "BUTTONS")
      : null;
    const dynamicButtons = Array.isArray(buttonBlock?.buttons)
      ? buttonBlock.buttons.filter((button: any) => String(button?.type || "").toUpperCase() === "URL" && buttonRequiresParameter(button))
      : [];
    out.buttons = buttonParams.map((value, idx) => ({
      type: String(dynamicButtons[idx]?.type || "url").trim().toLowerCase() || "url",
      parameter: value
    }));
  }
  return normalizeProcessedTemplateParams(out, args.components);
}

async function listAvailableWhatsappTemplates() {
  const cfg = await getChatwootConfig();
  if (!cfg.configured) throw new Error("chatwoot_not_configured");
  const client = new ChatwootClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    apiAccessToken: cfg.apiAccessToken,
    inboxId: cfg.inboxId
  });
  await client.syncWhatsappTemplates().catch(() => null);
  return client.listWhatsappTemplates();
}

function countBodyParams(components: any[], currentCount: number) {
  const body = components.find((component: any) => String(component?.type || "").toUpperCase() === "BODY") as any;
  if (!body) return 0;
  const countByText = countPlaceholderSlotsFromText(body?.text);
  const countByExample = Math.max(
    countPlaceholderSlotsFromExample(body?.example),
    countExampleValueSlots(body?.example?.body_text)
  );
  return Math.max(countByText, countByExample, currentCount);
}

function countHeaderParams(components: any[], currentCount: number) {
  const header = components.find((component: any) => String(component?.type || "").toUpperCase() === "HEADER") as any;
  if (!header) return 0;
  const format = String(header?.format || header?.format_type || "").toUpperCase();
  if (format && format !== "TEXT") return 0;
  const countByText = countPlaceholderSlotsFromText(header?.text);
  const countByExample = Math.max(
    countPlaceholderSlotsFromExample(header?.example),
    Array.isArray(header?.example?.header_text)
      ? header.example.header_text.filter((entry: unknown) => entry != null && String(entry).trim() !== "").length
      : 0
  );
  return Math.max(countByText, countByExample, currentCount);
}

function countButtonParams(components: any[], currentCount: number) {
  const buttons = components.find((component: any) => String(component?.type || "").toUpperCase() === "BUTTONS") as any;
  if (!buttons || !Array.isArray(buttons?.buttons)) return 0;
  const urlButtons = buttons.buttons.filter((button: any) => String(button?.type || "").toUpperCase() === "URL");
  const inferred = urlButtons.reduce((count: number, button: any) => {
    const hasPlaceholder = countPlaceholderSlotsFromText(button?.url) > 0;
    const hasExample = countPlaceholderSlotsFromExample(button?.example) > 0;
    return count + (hasPlaceholder || hasExample ? 1 : 0);
  }, 0);
  return Math.max(inferred, currentCount);
}

function extractPlaceholderIndexes(value: unknown): number[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  return matches
    .map((match) => {
      const num = Number(match.replace(/[^\d]/g, ""));
      return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
    })
    .filter((num) => num > 0);
}

function countPlaceholderSlotsFromText(value: unknown) {
  const indexes = extractPlaceholderIndexes(value);
  return indexes.length ? Math.max(...indexes) : 0;
}

function countPlaceholderSlotsFromExample(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (max, item) => Math.max(max, countPlaceholderSlotsFromExample(item)),
      0
    );
  }
  return 0;
}

function countExampleValueSlots(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((max, item) => {
    if (Array.isArray(item)) return Math.max(max, item.filter((entry) => entry != null && String(entry).trim() !== "").length);
    if (item && typeof item === "object") return Math.max(max, countExampleValueSlots(Object.values(item)));
    return max;
  }, 0);
}

function validateMappedParams(args: {
  name: string;
  language: string;
  bodyParams: string[];
  headerParams: string[];
  buttonParams: string[];
  templates: any[];
}) {
  const selectedTemplate =
    args.templates.find(
      (template: any) =>
        String(template?.name || "").trim() === args.name &&
        String(template?.language || "es").trim() === args.language
    ) || null;
  if (!selectedTemplate) throw new Error("whatsapp_template_not_found");

  const components = Array.isArray(selectedTemplate.components) ? selectedTemplate.components : [];
  const requiredBody = countBodyParams(components, args.bodyParams.length);
  const requiredHeader = countHeaderParams(components, args.headerParams.length);
  const requiredButtons = countButtonParams(components, args.buttonParams.length);

  const completeBody = args.bodyParams.length === requiredBody && args.bodyParams.every(Boolean);
  const completeHeader = args.headerParams.length === requiredHeader && args.headerParams.every(Boolean);
  const completeButtons = args.buttonParams.length === requiredButtons && args.buttonParams.every(Boolean);

  const missingSections: string[] = [];
  if (!completeBody) missingSections.push(`body:${requiredBody}`);
  if (!completeHeader) missingSections.push(`header:${requiredHeader}`);
  if (!completeButtons) missingSections.push(`buttons:${requiredButtons}`);
  if (missingSections.length) {
    throw new Error(`missing_template_params:${missingSections.join(",")}`);
  }
}

function validateAllowedTemplateVariables(args: {
  bodyParams: string[];
  headerParams: string[];
  buttonParams: string[];
  allowedBodyValues: Set<string>;
  allowedHeaderValues: Set<string>;
  allowedButtonValues: Set<string>;
}) {
  const invalidBody = args.bodyParams.filter((value) => !args.allowedBodyValues.has(value));
  const invalidHeader = args.headerParams.filter((value) => !args.allowedHeaderValues.has(value));
  const invalidButtons = args.buttonParams.filter((value) => !args.allowedButtonValues.has(value));
  const issues: string[] = [];
  if (invalidBody.length) issues.push(`body:${invalidBody.join(",")}`);
  if (invalidHeader.length) issues.push(`header:${invalidHeader.join(",")}`);
  if (invalidButtons.length) issues.push(`buttons:${invalidButtons.join(",")}`);
  if (issues.length) throw new Error(`invalid_template_variables:${issues.join(";")}`);
}

function normalizeTemplatePayload(formData: FormData, selectedTemplate?: any) {
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
      processed_params: buildProcessedParams({
        bodyParams,
        headerParams,
        buttonParams,
        components: Array.isArray(selectedTemplate?.components) ? selectedTemplate.components : []
      })
    },
    bodyParams,
    headerParams,
    buttonParams
  };
}

function samePaymentType(rule: NotificationRule, paymentType?: NotificationPaymentType) {
  const types = rule?.conditions?.requirePaymentTypeIn;
  if (!paymentType) return !types || !types.length;
  return Array.isArray(types) && types.includes(paymentType);
}

function isUnifiedPaymentTrigger(trigger: string) {
  return trigger === "PAYMENT_APPROVED";
}

function shouldDisableRule(trigger: string, paymentType: NotificationPaymentType | "ANY" | undefined, rule: NotificationRule) {
  if (isUnifiedPaymentTrigger(trigger)) return String(rule?.trigger || "") === trigger;
  if (!paymentType || paymentType === "ANY") {
    return String(rule?.trigger || "") === trigger && (!rule?.conditions?.requirePaymentTypeIn || !rule.conditions.requirePaymentTypeIn.length);
  }
  return String(rule?.trigger || "") === trigger && Array.isArray(rule?.conditions?.requirePaymentTypeIn) && rule.conditions.requirePaymentTypeIn.includes(paymentType);
}

function normalizeRulePaymentType(value: unknown): NotificationPaymentType | "ANY" {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "PLAN") return "PLAN";
  if (raw === "SUBSCRIPTION") return "SUBSCRIPTION";
  if (raw === "LINK") return "LINK";
  return "ANY";
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
    const availableTemplates = await listAvailableWhatsappTemplates();
    const selectedTemplate =
      availableTemplates.find(
        (template: any) =>
          String(template?.name || "").trim() === String(formData.get("waTemplateName") || "").trim() &&
          String(template?.language || "es").trim() === String(formData.get("waLanguage") || "es").trim()
      ) || null;
    const tplPayload = normalizeTemplatePayload(formData, selectedTemplate);
    validateMappedParams({
      name: tplPayload.chatwootTemplate.name,
      language: tplPayload.chatwootTemplate.language,
      bodyParams: tplPayload.bodyParams,
      headerParams: tplPayload.headerParams,
      buttonParams: tplPayload.buttonParams,
      templates: availableTemplates
    });
    const allowed = getAllowedTemplateValues({ type: "realtime", key });
    validateAllowedTemplateVariables({
      bodyParams: tplPayload.bodyParams,
      headerParams: tplPayload.headerParams,
      buttonParams: tplPayload.buttonParams,
      allowedBodyValues: allowed.bodyValues,
      allowedHeaderValues: allowed.headerValues,
      allowedButtonValues: allowed.buttonValues
    });

    const nextTemplates = templates.filter((t) => String(t.id) !== templateId);
    nextTemplates.push({
      id: templateId,
      name: meta.label,
      channel: "CHATWOOT",
      chatwootType: meta.chatwootType,
      content: tplPayload.content,
      chatwootTemplate: tplPayload.chatwootTemplate,
      meta: selectedTemplate
        ? {
            templateName: String(selectedTemplate.name || "").trim(),
            language: String(selectedTemplate.language || "es").trim(),
            components: selectedTemplate.components ?? []
          }
        : undefined
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

    const next = { ...(baseConfig || {}), templates: nextTemplates, rules: nextRules, version: 1 };
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

    const availableTemplates = await listAvailableWhatsappTemplates();
    const selectedTemplate =
      availableTemplates.find(
        (template: any) =>
          String(template?.name || "").trim() === String(formData.get("waTemplateName") || "").trim() &&
          String(template?.language || "es").trim() === String(formData.get("waLanguage") || "es").trim()
      ) || null;
    const tplPayload = normalizeTemplatePayload(formData, selectedTemplate);
    validateMappedParams({
      name: tplPayload.chatwootTemplate.name,
      language: tplPayload.chatwootTemplate.language,
      bodyParams: tplPayload.bodyParams,
      headerParams: tplPayload.headerParams,
      buttonParams: tplPayload.buttonParams,
      templates: availableTemplates
    });
    const allowed = getAllowedTemplateValues({ type: "reminder", kind: kind === "MORA" ? "MORA" : "DUE", paymentType });
    validateAllowedTemplateVariables({
      bodyParams: tplPayload.bodyParams,
      headerParams: tplPayload.headerParams,
      buttonParams: tplPayload.buttonParams,
      allowedBodyValues: allowed.bodyValues,
      allowedHeaderValues: allowed.headerValues,
      allowedButtonValues: allowed.buttonValues
    });
    const tplNameBase = kind === "MORA" ? "Recordatorio en mora" : "Recordatorio de fecha de pago";
    const tplName = `${tplNameBase} (${paymentType === "SUBSCRIPTION" ? "débito automático" : "link de pago"})`;

    const nextTemplates = templates.filter((t) => String(t.id) !== templateId);
    nextTemplates.push({
      id: templateId,
      name: tplName,
      channel: "CHATWOOT",
      chatwootType: "EXPIRY_WARNING",
      content: tplPayload.content,
      chatwootTemplate: tplPayload.chatwootTemplate,
      meta: selectedTemplate
        ? {
            templateName: String(selectedTemplate.name || "").trim(),
            language: String(selectedTemplate.language || "es").trim(),
            components: selectedTemplate.components ?? []
          }
        : undefined
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

    const next = { ...(baseConfig || {}), templates: nextTemplates, rules: nextRules, version: 1 };
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
      const paymentType = normalizeRulePaymentType(rules[idx]?.conditions?.requirePaymentTypeIn?.[0]);
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
