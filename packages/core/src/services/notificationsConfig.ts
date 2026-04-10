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

function defaultConfig(): NotificationsConfig {
  return {
    version: 1,
    templates: [],
    rules: []
  };
}

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

function isTokenizationTemplate(template: NotificationsConfig["templates"][number] | undefined | null): boolean {
  if (!template) return false;
  const name = String(template.chatwootTemplate?.name || template.name || "").toLowerCase();
  if (name.includes("tokeniz") || name.includes("tokenizaci") || name.includes("debito") || name.includes("débito")) return true;
  const content = String(template.content || "").toLowerCase();
  if (content.includes("tokeniz") || content.includes("tokenization") || content.includes("tokenizacion")) return true;
  const params = template.chatwootTemplate?.processed_params || {};
  const values: string[] = [];
  if (Array.isArray((params as any).body)) values.push(...(params as any).body.map((p: any) => String(p?.value || "")));
  if (Array.isArray((params as any).header)) values.push(...(params as any).header.map((p: any) => String(p?.value || "")));
  if (Array.isArray((params as any).buttons)) values.push(...(params as any).buttons.map((p: any) => String(p?.value || "")));
  return values.some((v) => v.toLowerCase().includes("tokeniz") || v.toLowerCase().includes("tokenizacion"));
}

function hasUsableWhatsAppTemplate(template: NotificationsConfig["templates"][number] | undefined | null): boolean {
  if (!template) return false;
  if (String(template.channel || "").toUpperCase() !== "CHATWOOT") return false;
  return Boolean(String(template.chatwootTemplate?.name || "").trim());
}

function normalizeNotificationsConfig(cfg: NotificationsConfig): NotificationsConfig {
  const templates = Array.isArray(cfg.templates) ? cfg.templates : [];
  const validTemplates = templates.filter((t) => hasUsableWhatsAppTemplate(t));
  const templateById = new Map(validTemplates.map((t) => [String(t.id), t]));
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const nextRules = rules.map((rule) => {
    const next = { ...rule, conditions: rule.conditions ? { ...rule.conditions } : undefined } as typeof rule;
    if (next.trigger === "PAYMENT_LINK_CREATED") {
      const tpl = templateById.get(String(next.templateId));
      if (isTokenizationTemplate(tpl)) {
        next.trigger = "TOKENIZATION_LINK_CREATED" as any;
        if (next.conditions?.requirePaymentTypeIn) delete next.conditions.requirePaymentTypeIn;
      } else if (!next.conditions?.requirePaymentTypeIn || next.conditions.requirePaymentTypeIn.length === 0) {
        next.conditions = { ...(next.conditions || {}), requirePaymentTypeIn: ["LINK"] as any };
      }
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
