import { isNotificationTemplateConfigured } from "../lib/notificationTemplate";
import { REALTIME_NOTIFICATION_DEFINITIONS, type RealtimeNotificationKey } from "./realtimeDefinitions";

export type Env = "PRODUCTION" | "SANDBOX";

export type Template = {
  id: string;
  name: string;
  channel: "CHATWOOT" | "META";
  chatwootType?: "PAYMENT_LINK" | "PAYMENT_CONFIRMED" | "EXPIRY_WARNING" | "PAYMENT_FAILED";
  content?: string | null;
  chatwootTemplate?: {
    name: string;
    language: string;
    processed_params?: {
      body?: Array<{ key: string; value: string }>;
      header?: Array<{ key: string; value: string }>;
      buttons?: Array<{ index?: string | number; key?: string; value?: string }>;
    };
  } | null;
};

export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "SUBSCRIPTION_DUE" | "PAYMENT_LINK_CREATED" | "CATALOG_LINK_CREATED" | "TOKENIZATION_LINK_CREATED" | "PAYMENT_APPROVED" | "PAYMENT_DECLINED";
  templateId: string;
  offsetsSeconds?: number[];
  atTimeUtc?: string | null;
  ensurePaymentLink?: boolean;
  checkoutTemplateId?: string | null;
  conditions?: {
    requirePaymentTypeIn?: Array<"PLAN" | "SUBSCRIPTION" | "LINK">;
  };
};

export const REALTIME_TYPES: Array<{
  key: RealtimeNotificationKey;
  label: string;
  aliases?: string[];
  trigger: Rule["trigger"];
  chatwootType: Template["chatwootType"];
  paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK";
}> = REALTIME_NOTIFICATION_DEFINITIONS;

export const REMINDER_TPL_DUE_LINK = "tpl_reminder_due_link";
export const REMINDER_TPL_DUE_SUBSCRIPTION = "tpl_reminder_due_subscription";
export const REMINDER_TPL_MORA_LINK = "tpl_reminder_mora_link";
export const REMINDER_TPL_MORA_SUBSCRIPTION = "tpl_reminder_mora_subscription";

export const REMINDER_TYPES = [
  { key: "reminder_due_link", kind: "DUE", paymentType: "LINK", label: "Recordatorio antes del vencimiento (link de pago)", templateId: REMINDER_TPL_DUE_LINK },
  { key: "reminder_due_subscription", kind: "DUE", paymentType: "SUBSCRIPTION", label: "Recordatorio antes del vencimiento (débito automático)", templateId: REMINDER_TPL_DUE_SUBSCRIPTION },
  { key: "reminder_mora_link", kind: "MORA", paymentType: "LINK", label: "Recordatorio en mora (link de pago)", templateId: REMINDER_TPL_MORA_LINK },
  { key: "reminder_mora_subscription", kind: "MORA", paymentType: "SUBSCRIPTION", label: "Recordatorio en mora (débito automático)", templateId: REMINDER_TPL_MORA_SUBSCRIPTION }
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];

export type OffsetItem = { amount: string; unit: "minutes" | "hours" | "days" };

export function secondsFromOffset(item: OffsetItem, sign: 1 | -1) {
  const amount = Number(item.amount || 0);
  const base = item.unit === "days" ? amount * 24 * 60 * 60 : item.unit === "hours" ? amount * 60 * 60 : amount * 60;
  return Math.trunc(base * sign);
}

export function offsetsToItems(offsets?: number[]): OffsetItem[] {
  if (!offsets?.length) return [{ amount: "1", unit: "days" }];
  return offsets.map((sec) => {
    const abs = Math.abs(Number(sec));
    if (abs % (24 * 60 * 60) === 0) return { amount: String(abs / (24 * 60 * 60)), unit: "days" as const };
    if (abs % (60 * 60) === 0) return { amount: String(abs / (60 * 60)), unit: "hours" as const };
    return { amount: String(abs / 60), unit: "minutes" as const };
  });
}

/** Una fila de la lista de notificaciones; `id` es el segmento de /notifications/[id]. */
export type NotificationEntry = {
  id: string;
  type: "realtime" | "reminder";
  label: string;
  subtitle: string;
  statusLabel: string;
  statusPill: string;
  ruleId: string;
  enabled: boolean;
  rule: Rule | null;
  template: Template | null;
  realtime?: (typeof REALTIME_TYPES)[number];
  reminder?: ReminderType;
};

function findReminderRule(rules: Rule[], kind: "DUE" | "MORA", paymentType: "LINK" | "SUBSCRIPTION") {
  return rules.find((r) => {
    if (r.trigger !== "SUBSCRIPTION_DUE") return false;
    const offsets = r.offsetsSeconds || [];
    const isDue = offsets.some((s) => Number(s) <= 0);
    const isMora = offsets.some((s) => Number(s) > 0);
    if (kind === "DUE" && !isDue) return false;
    if (kind === "MORA" && !isMora) return false;
    const types = r.conditions?.requirePaymentTypeIn;
    if (paymentType === "SUBSCRIPTION") return Array.isArray(types) && types.includes("SUBSCRIPTION");
    if (!types || !types.length) return true;
    return Array.isArray(types) && types.includes("LINK");
  });
}

/**
 * Cruza las plantillas y reglas guardadas con las notificaciones que ofrece el sistema
 * (las de tiempo real y los recordatorios). Es la lógica que antes vivía dentro del
 * componente de cliente; ahora la comparten la lista y la página del editor.
 */
export function buildNotificationEntries(templates: Template[], rules: Rule[]): NotificationEntry[] {
  const templateById = new Map<string, Template>();
  templates.forEach((t) => templateById.set(String(t.id), t));

  const realtime = REALTIME_TYPES.map((rt): NotificationEntry => {
    let rule: Rule | null =
      rules.find((r) => {
        if (r.trigger !== rt.trigger) return false;
        const types = r.conditions?.requirePaymentTypeIn;
        if (!rt.paymentType) return !types || !types.length;
        return Array.isArray(types) && types.includes(rt.paymentType);
      }) || null;
    if (!rule && !rt.paymentType) rule = rules.find((r) => r.trigger === rt.trigger) || null;

    let template: Template | null = rule ? templateById.get(String(rule.templateId)) || null : null;
    if (!template) {
      const names = [rt.label, ...(rt.aliases || [])].filter(Boolean) as string[];
      template = templates.find((t) => t.chatwootType === rt.chatwootType && names.includes(t.name)) || null;
    }
    const configured = Boolean(rule && isNotificationTemplateConfigured(template));
    return {
      id: rt.key,
      type: "realtime",
      label: rt.label,
      subtitle: "Plantilla WhatsApp",
      statusLabel: configured ? (rule?.enabled ? "Activa" : "Inactiva") : "No configurada",
      statusPill: configured && rule?.enabled ? "pill-green" : "pill-muted",
      ruleId: rule?.id || "",
      enabled: Boolean(rule?.enabled),
      rule,
      template,
      realtime: rt
    };
  });

  const reminders = REMINDER_TYPES.map((rt): NotificationEntry => {
    const rule = findReminderRule(rules, rt.kind, rt.paymentType) || null;
    const template = templateById.get(rt.templateId) || null;
    const configured = Boolean(rule && isNotificationTemplateConfigured(template));
    return {
      id: rt.key,
      type: "reminder",
      label: rt.label,
      subtitle: rt.kind === "DUE" ? "Antes del vencimiento" : "Después del vencimiento",
      statusLabel: configured ? (rule?.enabled ? "Activa" : "Inactiva") : "No configurada",
      statusPill: configured && rule?.enabled ? "pill-green" : "pill-muted",
      ruleId: rule?.id || "",
      enabled: Boolean(rule?.enabled),
      rule,
      template,
      reminder: rt
    };
  });

  return [...realtime, ...reminders];
}

export function findNotificationEntry(id: string, templates: Template[], rules: Rule[]) {
  return buildNotificationEntries(templates, rules).find((entry) => entry.id === id) || null;
}
