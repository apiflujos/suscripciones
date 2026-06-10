import { z } from "zod";

export const envSchema = z.enum(["PRODUCTION", "SANDBOX"]);
export type ActiveEnv = z.infer<typeof envSchema>;

export function maskSecret(value: string | undefined) {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 4) return "****";
  return `${"*".repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}

export const wompiUpdateSchema = z.object({
  environment: envSchema.optional(),
  activeEnv: envSchema.optional(),
  publicKey: z.string().min(1).optional(),
  privateKey: z.string().min(1).optional(),
  integritySecret: z.string().min(1).optional(),
  eventsSecret: z.string().min(1).optional(),
  apiBaseUrl: z.string().url().optional(),
  checkoutLinkBaseUrl: z.string().url().optional(),
  redirectUrl: z.string().url().optional().or(z.literal(""))
});

export const wompiTestSchema = z.object({
  environment: envSchema.optional(),
  publicKey: z.string().optional().or(z.literal("")),
  apiBaseUrl: z.string().url().optional().or(z.literal(""))
});

export const envOnlySchema = z.object({
  environment: envSchema.optional()
});

export const shopifyUpdateSchema = z.object({
  forwardUrl: z.string().url().optional().or(z.literal("")),
  forwardSecret: z.string().optional().or(z.literal("")),
  forwardOrigin: z.enum(["shopify", "shopify-native"]).optional(),
  forwardRetryEnabled: z.union([z.boolean(), z.string()]).optional(),
  forwardRetryMinutes: z.coerce.number().int().positive().optional()
});

export const autoDebitUpdateSchema = z.object({
  enabled: z.union([z.boolean(), z.string()]).optional(),
  chargeAtCutoffEnabled: z.union([z.boolean(), z.string()]).optional(),
  allowManualCharge: z.union([z.boolean(), z.string()]).optional(),
  executionHour: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  timeZone: z.string().min(1).max(120).optional(),
  retryEnabled: z.union([z.boolean(), z.string()]).optional(),
  retryEveryValue: z.coerce.number().int().min(1).max(10080).optional(),
  retryEveryUnit: z.enum(["MINUTES", "HOURS", "DAYS"]).optional(),
  retryEveryMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  maxRetries: z.coerce.number().int().min(0).max(20).optional(),
  graceDays: z.coerce.number().int().min(1).max(30).optional()
});

export const paymentsConfigUpdateSchema = z.object({
  autoReconcileUnlinkedPayments: z.union([z.boolean(), z.string()]).optional(),
  acceptUnlinkedPayments: z.union([z.boolean(), z.string()]).optional(),
  notifyWhatsappForUnlinkedPayments: z.union([z.boolean(), z.string()]).optional(),
  includeUnlinkedPaymentsInMetrics: z.union([z.boolean(), z.string()]).optional()
});

export const chatwootUpdateSchema = z.object({
  environment: envSchema.optional(),
  activeEnv: envSchema.optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
  accountId: z.coerce.number().int().positive().optional(),
  apiAccessToken: z.string().optional().or(z.literal("")),
  inboxId: z.coerce.number().int().positive().optional(),
  productTemplateName: z.string().optional().or(z.literal("")),
  productTemplateLang: z.string().optional().or(z.literal(""))
});

export const aiProviderSchema = z.enum(["OPENAI", "DEEPSEEK"]);
export const aiUpdateSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().optional().or(z.literal(""))
});

export const aiDeleteSchema = z.object({
  provider: aiProviderSchema
});

export const checkoutConfigUpdateSchema = z.object({
  planBaseUrl: z.string().url().optional().or(z.literal("")),
  subscriptionBaseUrl: z.string().url().optional().or(z.literal("")),
  cartBaseUrl: z.string().url().optional().or(z.literal("")),
  defaultUtmParams: z.string().optional().or(z.literal("")),
  tokenExpiryHours: z.coerce.number().int().positive().optional(),
  defaultPlanTemplateId: z.string().optional().or(z.literal("")),
  defaultSubscriptionTemplateId: z.string().optional().or(z.literal("")),
  defaultCartTemplateId: z.string().optional().or(z.literal("")),
  logoUrl: z.string().optional().or(z.literal("")),
  supportEmail: z.string().optional().or(z.literal("")),
  supportUrl: z.string().optional().or(z.literal("")),
  planTitle: z.string().optional().or(z.literal("")),
  planDescription: z.string().optional().or(z.literal("")),
  subscriptionTitle: z.string().optional().or(z.literal("")),
  subscriptionDescription: z.string().optional().or(z.literal("")),
  planWompiTitle: z.string().optional().or(z.literal("")),
  planWompiDescription: z.string().optional().or(z.literal("")),
  subscriptionWompiTitle: z.string().optional().or(z.literal("")),
  subscriptionWompiDescription: z.string().optional().or(z.literal("")),
  tokenizationSuccessTitle: z.string().optional().or(z.literal("")),
  tokenizationSuccessMessage: z.string().optional().or(z.literal("")),
  tokenizationErrorMessage: z.string().optional().or(z.literal("")),
  tokenizationReturnUrl: z.string().url().optional().or(z.literal(""))
});

export function toBool(raw: unknown, fallback: boolean) {
  if (raw == null) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (!v) return fallback;
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}

export function toInt(raw: unknown, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function normalizeRetryUnit(raw: unknown): "MINUTES" | "HOURS" | "DAYS" {
  const unit = String(raw || "")
    .trim()
    .toUpperCase();
  if (unit === "DAYS") return "DAYS";
  if (unit === "HOURS") return "HOURS";
  return "MINUTES";
}

export function retryUnitMultiplier(unit: "MINUTES" | "HOURS" | "DAYS") {
  if (unit === "DAYS") return 24 * 60;
  if (unit === "HOURS") return 60;
  return 1;
}

export function deriveRetryUnitAndValue(minutes: number): {
  retryEveryValue: number;
  retryEveryUnit: "MINUTES" | "HOURS" | "DAYS";
} {
  if (minutes % (24 * 60) === 0) return { retryEveryValue: Math.max(1, Math.trunc(minutes / (24 * 60))), retryEveryUnit: "DAYS" };
  if (minutes % 60 === 0) return { retryEveryValue: Math.max(1, Math.trunc(minutes / 60)), retryEveryUnit: "HOURS" };
  return { retryEveryValue: Math.max(1, Math.trunc(minutes)), retryEveryUnit: "MINUTES" };
}
