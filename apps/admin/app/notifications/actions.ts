"use server";

import { redirect } from "next/navigation";
import { normalizeToken } from "../lib/normalizeToken";
import { assertSameOrigin } from "../lib/csrf";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const TOKEN = normalizeToken(process.env.ADMIN_API_TOKEN || "");

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

async function adminFetch(path: string, init: RequestInit) {
  await assertSameOrigin();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, "x-admin-token": TOKEN } : {}),
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || json?.error || `request_failed_${res.status}`);
  return json;
}

async function getNotificationsConfig(environment: "PRODUCTION" | "SANDBOX") {
  const qs = `?environment=${encodeURIComponent(environment)}`;
  const res = await adminFetch(`/admin/notifications/config${qs}`, { method: "GET" });
  return res?.config as any;
}

async function putNotificationsConfig(environment: "PRODUCTION" | "SANDBOX", config: any) {
  return adminFetch("/admin/notifications/config", {
    method: "PUT",
    body: JSON.stringify({ environment, config })
  });
}

function normalizeEnv(value: unknown): "PRODUCTION" | "SANDBOX" {
  const v = String(value || "").trim().toUpperCase();
  return v === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}

function slugifyId(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function chatwootTypeForTrigger(trigger: string) {
  if (trigger === "SUBSCRIPTION_DUE") return "EXPIRY_WARNING";
  if (trigger === "PAYMENT_LINK_CREATED") return "PAYMENT_LINK";
  if (trigger === "PAYMENT_APPROVED") return "PAYMENT_CONFIRMED";
  if (trigger === "PAYMENT_DECLINED") return "PAYMENT_FAILED";
  return "EXPIRY_WARNING";
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

  const allowedTriggers = new Set(["SUBSCRIPTION_DUE", "PAYMENT_LINK_CREATED", "PAYMENT_APPROVED", "PAYMENT_DECLINED"]);
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
    const baseName =
      title ||
      (trigger === "SUBSCRIPTION_DUE"
        ? "Recordatorio de pago"
        : trigger === "PAYMENT_LINK_CREATED"
          ? "Envío de link de pago"
          : trigger === "PAYMENT_APPROVED"
            ? "Pago aprobado"
            : "Pago rechazado");

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
  const raw = String(formData.get("configJson") || "").trim();

  try {
    const parsed = raw ? JSON.parse(raw) : null;
    await adminFetch("/admin/notifications/config", {
      method: "PUT",
      body: JSON.stringify({
        ...(environment === "PRODUCTION" || environment === "SANDBOX" ? { environment } : {}),
        config: parsed
      })
    });
    const env = environment === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
    redirect(`/notifications?env=${env}&saved=1`);
  } catch (err) {
    const env = environment === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
    redirect(`/notifications?env=${env}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function addTextTemplate(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
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
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function addWhatsAppTemplate(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
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
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function deleteTemplate(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
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
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function toggleRule(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  const ruleId = String(formData.get("ruleId") || "").trim();
  const enabled = String(formData.get("enabled") || "").trim() === "1";
  if (!ruleId) return redirect(`/notifications?env=${environment}&error=missing_rule_id`);
  try {
    const config = await getNotificationsConfig(environment);
    const rules = Array.isArray(config?.rules)
      ? config.rules.map((r: any) => (String(r.id) === ruleId ? { ...r, enabled } : r))
      : [];
    const next = { ...(config || {}), rules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function deleteRule(formData: FormData) {
  const environment = normalizeEnv(formData.get("environment"));
  const ruleId = String(formData.get("ruleId") || "").trim();
  if (!ruleId) return redirect(`/notifications?env=${environment}&error=missing_rule_id`);
  try {
    const config = await getNotificationsConfig(environment);
    const rules = Array.isArray(config?.rules) ? config.rules.filter((r: any) => String(r.id) !== ruleId) : [];
    const next = { ...(config || {}), rules };
    await putNotificationsConfig(environment, next);
    redirect(`/notifications?env=${environment}&saved=1`);
  } catch (err) {
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function scheduleSubscription(formData: FormData) {
  const subscriptionId = String(formData.get("subscriptionId") || "").trim();
  const forceNow = String(formData.get("forceNow") || "").trim() === "1";
  const environment = normalizeEnv(formData.get("environment"));
  if (!subscriptionId) return redirect(`/notifications?env=${environment}&error=missing_subscription_id`);

  try {
    const qs = forceNow ? "?forceNow=1" : "";
    const result = await adminFetch(`/admin/notifications/schedule/subscription/${encodeURIComponent(subscriptionId)}${qs}`, { method: "POST" });
    redirect(`/notifications?env=${environment}&scheduled=${encodeURIComponent(String(result?.scheduled ?? 0))}`);
  } catch (err) {
    redirect(`/notifications?env=${environment}&error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
