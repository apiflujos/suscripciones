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

export const notificationTriggerSchema = z.enum(["SUBSCRIPTION_DUE", "PAYMENT_APPROVED", "PAYMENT_DECLINED"]);
export type NotificationTrigger = z.infer<typeof notificationTriggerSchema>;

export const notificationChannelSchema = z.enum(["CHATWOOT", "META"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

const paymentStatusSchema = z.enum(["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"]);
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
  ensurePaymentLink: z.boolean().optional(),
  conditions: z
    .object({
      skipIfSubscriptionStatusIn: z.array(subscriptionStatusSchema).optional(),
      skipIfPaymentStatusIn: z.array(paymentStatusSchema).optional(),
      requirePaymentStatusIn: z.array(paymentStatusSchema).optional()
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

export async function getNotificationsConfigForEnv(env: ActiveEnv): Promise<NotificationsConfig> {
  const raw =
    (await getCredential(CredentialProvider.CHATWOOT, keyForEnv(env))) ||
    (await getCredential(CredentialProvider.CHATWOOT, "NOTIFICATIONS_CONFIG")) ||
    (process.env.NOTIFICATIONS_CONFIG_JSON || "").trim();

  if (!raw) return defaultConfig();

  try {
    const parsed = JSON.parse(raw);
    const cfg = notificationsConfigSchema.parse(parsed);
    return cfg;
  } catch {
    return defaultConfig();
  }
}

export async function setNotificationsConfig(cfg: unknown, opts?: { environment?: ActiveEnv }) {
  const env = opts?.environment || (await getCommsActiveEnv());
  const normalized = notificationsConfigSchema.parse(cfg);
  await setCredential(CredentialProvider.CHATWOOT, keyForEnv(env), JSON.stringify(normalized));
  return normalized;
}
