import { CredentialProvider } from "@prisma/client";
import { z } from "zod";
import { getCredential, setCredential } from "./credentials";

export type ActiveEnv = "PRODUCTION" | "SANDBOX";

function normalizeActiveEnv(value: string | undefined): ActiveEnv {
  const v = String(value || "")
    .trim()
    .toUpperCase();
  return v === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}

async function getCommsActiveEnv(): Promise<ActiveEnv> {
  const fromDb = await getCredential(CredentialProvider.CHATWOOT, "ACTIVE_ENV");
  if (fromDb) return normalizeActiveEnv(fromDb);
  return normalizeActiveEnv(process.env.CHATWOOT_ACTIVE_ENV);
}

export const notificationTriggerSchema = z.enum([
  "SUBSCRIPTION_DUE",
  "PAYMENT_LINK_CREATED",
  "PAYMENT_APPROVED",
  "PAYMENT_DECLINED",
  "CATALOG_LINK_CREATED",
  "TOKENIZATION_LINK_CREATED"
]);
export type NotificationTrigger = z.infer<typeof notificationTriggerSchema>;

export const notificationChannelSchema = z.enum(["CHATWOOT", "META"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

const paymentStatusSchema = z.enum(["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"]);
const paymentTypeSchema = z.enum(["PLAN", "SUBSCRIPTION", "LINK"]);
const subscriptionStatusSchema = z.enum(["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"]);
const chatwootMessageTypeSchema = z.enum(["PAYMENT_LINK", "PAYMENT_CONFIRMED", "EXPIRY_WARNING", "PAYMENT_FAILED"]);

const chatwootTemplateParamsSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1).optional(),
  language: z.string().min(1),
  processed_params: z.any().optional()
});

const templateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    channel: notificationChannelSchema,
    chatwootType: chatwootMessageTypeSchema.optional(),
    content: z.string().min(1).optional(),
    chatwootTemplate: chatwootTemplateParamsSchema.optional(),
    meta: z
      .object({
        templateName: z.string().min(1),
        language: z.string().min(1),
        components: z.any().optional()
      })
      .optional()
  })
  .superRefine((val, ctx) => {
    if (val.channel === "CHATWOOT") {
      if (!val.chatwootType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chatwootType requerido", path: ["chatwootType"] });
      if (!val.content && !val.chatwootTemplate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "content o chatwootTemplate requerido", path: ["content"] });
      return;
    }
    if (!val.meta) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "meta requerido", path: ["meta"] });
  });

const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger: notificationTriggerSchema,
  templateId: z.string().min(1),
  offsetsSeconds: z.array(z.number().int()).optional(),
  offsetsMinutes: z.array(z.number().int()).optional(),
  atTimeUtc: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  ensurePaymentLink: z.boolean().optional(),
  conditions: z
    .object({
      skipIfSubscriptionStatusIn: z.array(subscriptionStatusSchema).optional(),
      skipIfPaymentStatusIn: z.array(paymentStatusSchema).optional(),
      requirePaymentStatusIn: z.array(paymentStatusSchema).optional(),
      requirePaymentTypeIn: z.array(paymentTypeSchema).optional()
    })
    .optional()
});

export const notificationsConfigSchema = z.object({
  version: z.number().int().default(1),
  templates: z.array(templateSchema).default([]),
  rules: z.array(ruleSchema).default([])
});

export type NotificationsConfig = z.infer<typeof notificationsConfigSchema>;
export type NotificationTemplate = NotificationsConfig["templates"][number];
export type NotificationRule = NotificationsConfig["rules"][number];
export type NotificationPaymentType = NonNullable<
  NonNullable<NotificationRule["conditions"]>["requirePaymentTypeIn"]
>[number];

function defaultConfig(): NotificationsConfig {
  return {
    version: 1,
    templates: [],
    rules: []
  };
}

const CANONICAL_TEMPLATE_NAMES: Record<string, string> = {
  tpl_rt_catalog_link_created_plan: "Catálogo enviado (link de pago)",
  tpl_rt_catalog_link_created_subscription: "Catálogo enviado (suscripción · link de pago)",
  tpl_rt_tokenization_link_created: "Tokenización enviada (débito automático)",
  tpl_rt_payment_link_created: "Link de pago creado",
  tpl_rt_payment_link_created_subscription: "Link de pago creado (suscripción)",
  tpl_rt_payment_success: "Pago exitoso",
  tpl_rt_payment_failed_link: "Pago fallido (link de pago)",
  tpl_rt_payment_failed_subscription: "Pago fallido (débito automático)",
  tpl_reminder_due_link: "Recordatorio de fecha de pago (link de pago)",
  tpl_reminder_due_subscription: "Recordatorio de fecha de pago (débito automático)",
  tpl_reminder_mora_link: "Recordatorio en mora (link de pago)",
  tpl_reminder_mora_subscription: "Recordatorio en mora (débito automático)"
};

const CANONICAL_RULE_NAMES: Record<string, string> = {
  rule_rt_catalog_link_created_plan: "Catálogo enviado (link de pago)",
  rule_rt_catalog_link_created_subscription: "Catálogo enviado (suscripción · link de pago)",
  rule_rt_tokenization_link_created: "Tokenización enviada (débito automático)",
  rule_rt_payment_link_created: "Link de pago creado",
  rule_rt_payment_link_created_subscription: "Link de pago creado (suscripción)",
  rule_rt_payment_success: "Pago exitoso",
  rule_rt_payment_failed_link: "Pago fallido (link de pago)",
  rule_rt_payment_failed_subscription: "Pago fallido (débito automático)",
  rule_reminder_due_link: "Recordatorio de fecha de pago (link de pago)",
  rule_reminder_due_subscription: "Recordatorio de fecha de pago (débito automático)",
  rule_reminder_mora_link: "Recordatorio en mora (link de pago)",
  rule_reminder_mora_subscription: "Recordatorio en mora (débito automático)"
};

function keyForEnv(env: ActiveEnv) {
  return `NOTIFICATIONS_CONFIG_${env}`;
}

export async function getNotificationsConfig(): Promise<NotificationsConfig> {
  const env = await getCommsActiveEnv();
  return getNotificationsConfigForEnv(env);
}

export async function getNotificationsActiveEnv(): Promise<ActiveEnv> {
  return getCommsActiveEnv();
}

export async function getNotificationsConfigForEnv(env: ActiveEnv): Promise<NotificationsConfig> {
  const raw =
    (await getCredential(CredentialProvider.CHATWOOT, keyForEnv(env))) ||
    (await getCredential(CredentialProvider.CHATWOOT, "NOTIFICATIONS_CONFIG")) ||
    (process.env.NOTIFICATIONS_CONFIG_JSON || "").trim();

  if (!raw) return defaultConfig();

  try {
    const parsed = JSON.parse(raw);
    const cfg = notificationsConfigSchema.parse(parsed);
    return normalizeNotificationsConfig(cfg);
  } catch {
    return defaultConfig();
  }
}

function hasTokenizationKeyword(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("tokeniz") ||
    normalized.includes("tokenizaci") ||
    normalized.includes("tokenization") ||
    normalized.includes("debito") ||
    normalized.includes("débito")
  );
}

function isLegacyTokenizationRule(args: {
  rule: NotificationsConfig["rules"][number];
  template: NotificationsConfig["templates"][number] | undefined | null;
}): boolean {
  const rule = args.rule;
  const template = args.template;
  const ruleHints = [
    rule.id,
    rule.name
  ];
  const templateHints = template
    ? [
        template.id,
        template.name,
        template.chatwootTemplate?.name
      ]
    : [];
  return [...ruleHints, ...templateHints].some((value) => hasTokenizationKeyword(value));
}

function hasUsableWhatsAppTemplate(template: NotificationsConfig["templates"][number] | undefined | null): boolean {
  if (!template) return false;
  if (String(template.channel || "").toUpperCase() !== "CHATWOOT") return false;
  return Boolean(String(template.chatwootTemplate?.name || "").trim());
}

export function resolveNotificationRule(args: {
  rules?: NotificationRule[];
  trigger: NotificationTrigger;
  paymentType?: NotificationPaymentType;
}): NotificationRule | null {
  const rules = Array.isArray(args.rules) ? args.rules : [];
  const candidates = rules.filter((rule) => rule.enabled && rule.trigger === args.trigger);
  if (!candidates.length) return null;

  if (args.paymentType) {
    const paymentType = args.paymentType;
    const exact =
      candidates.find((rule) => {
        const types = rule.conditions?.requirePaymentTypeIn || [];
        return types.includes(paymentType);
      }) || null;
    if (exact) return exact;
  }

  return (
    candidates.find((rule) => {
      const types = rule.conditions?.requirePaymentTypeIn || [];
      return types.length === 0;
    }) || null
  );
}

export function resolveNotificationTemplate(args: {
  rules?: NotificationRule[];
  templates?: NotificationTemplate[];
  trigger: NotificationTrigger;
  paymentType?: NotificationPaymentType;
}): NotificationTemplate | null {
  const rule = resolveNotificationRule({
    rules: args.rules,
    trigger: args.trigger,
    paymentType: args.paymentType
  });
  if (!rule) return null;

  const templates = Array.isArray(args.templates) ? args.templates : [];
  return templates.find((template) => String(template.id) === String(rule.templateId)) || null;
}

export function filterNotificationRules(args: {
  rules?: NotificationRule[];
  trigger: NotificationTrigger;
  paymentType?: NotificationPaymentType | null;
}) {
  const rules = Array.isArray(args.rules) ? args.rules : [];
  const normalized = String(args.paymentType || "").trim().toUpperCase();
  return rules.filter((rule) => {
    if (!rule.enabled || rule.trigger !== args.trigger) return false;
    const required = rule.conditions?.requirePaymentTypeIn || [];
    if (!required.length) return true;
    if (!normalized) return false;
    return required.includes(normalized as NotificationPaymentType);
  });
}

function normalizeNotificationsConfig(cfg: NotificationsConfig): NotificationsConfig {
  const templates = Array.isArray(cfg.templates) ? cfg.templates : [];
  const validTemplates = templates
    .map((template) => {
      const canonicalName = CANONICAL_TEMPLATE_NAMES[String(template.id)];
      return canonicalName ? { ...template, name: canonicalName } : template;
    })
    .filter((t) => hasUsableWhatsAppTemplate(t));
  const templateById = new Map(validTemplates.map((t) => [String(t.id), t]));
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const nextRules = rules.map((rule) => {
    const canonicalName = CANONICAL_RULE_NAMES[String(rule.id)];
    const next = {
      ...rule,
      ...(canonicalName ? { name: canonicalName } : {}),
      conditions: rule.conditions ? { ...rule.conditions } : undefined
    } as typeof rule;
    const ruleId = String(next.id || "").trim().toLowerCase();
    const ruleName = String(next.name || "").trim().toLowerCase();
    if (next.trigger === "PAYMENT_LINK_CREATED") {
      const tpl = templateById.get(String(next.templateId));
      if (isLegacyTokenizationRule({ rule: next, template: tpl })) {
        next.trigger = "TOKENIZATION_LINK_CREATED";
        if (next.conditions?.requirePaymentTypeIn) delete next.conditions.requirePaymentTypeIn;
      } else if (ruleId.includes("subscription") || ruleName.includes("suscrip")) {
        next.conditions = { ...(next.conditions || {}), requirePaymentTypeIn: ["SUBSCRIPTION"] };
      } else if (!next.conditions?.requirePaymentTypeIn || next.conditions.requirePaymentTypeIn.length === 0) {
        next.conditions = { ...(next.conditions || {}), requirePaymentTypeIn: ["LINK"] };
      }
    } else if (next.trigger === "TOKENIZATION_LINK_CREATED") {
      if (next.conditions?.requirePaymentTypeIn) delete next.conditions.requirePaymentTypeIn;
    }
    return next;
  });
  const activeRuleIds = new Set(nextRules.map((r) => String(r.templateId)));
  const filteredTemplates = validTemplates.filter((t) => activeRuleIds.has(String(t.id)));
  const filteredTemplateIds = new Set(filteredTemplates.map((t) => String(t.id)));
  const filteredRules = nextRules.filter((r) => filteredTemplateIds.has(String(r.templateId)));
  return { ...cfg, templates: filteredTemplates, rules: filteredRules };
}

export async function setNotificationsConfig(cfg: unknown, opts?: { environment?: ActiveEnv }) {
  const env = opts?.environment || (await getCommsActiveEnv());
  const normalized = normalizeNotificationsConfig(notificationsConfigSchema.parse(cfg));
  await setCredential(CredentialProvider.CHATWOOT, keyForEnv(env), JSON.stringify(normalized));
  return normalized;
}
