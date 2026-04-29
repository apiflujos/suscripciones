import { z } from "zod";
import { notificationTriggerSchema } from "./notificationsConfig";

const uuidField = z.preprocess((value) => {
  if (value == null) return undefined;
  const normalized = String(value || "").trim();
  return normalized || undefined;
}, z.string().uuid().optional());

const baseNotificationJobPayloadSchema = z.object({
  trigger: notificationTriggerSchema,
  ruleId: z.string().min(1),
  offsetSeconds: z.number().int().optional(),
  anchorAt: z.string().datetime().optional(),
  customerId: uuidField,
  subscriptionId: uuidField,
  paymentId: uuidField,
  immediateSend: z.boolean().optional()
});

export const subscriptionDueJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
  trigger: z.literal("SUBSCRIPTION_DUE"),
  customerId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  cycleNumber: z.number().int().positive(),
  anchorAt: z.string().datetime()
});

export const paymentStatusJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
  trigger: z.enum(["PAYMENT_APPROVED", "PAYMENT_DECLINED"]),
  customerId: z.string().uuid(),
  paymentId: z.string().uuid(),
  paymentStatus: z.enum(["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"]),
  anchorAt: z.string().datetime()
});

export const paymentLinkCreatedJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
  trigger: z.literal("PAYMENT_LINK_CREATED"),
  customerId: z.string().uuid(),
  paymentId: z.string().uuid(),
  anchorAt: z.string().datetime()
});

export const catalogLinkCreatedJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
  trigger: z.literal("CATALOG_LINK_CREATED"),
  customerId: z.string().uuid(),
  catalogUrl: z.string().url(),
  anchorAt: z.string().datetime(),
  paymentType: z.enum(["PLAN", "SUBSCRIPTION", "LINK"]).optional()
});

export const tokenizationLinkCreatedJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
  trigger: z.literal("TOKENIZATION_LINK_CREATED"),
  customerId: z.string().uuid(),
  tokenUrl: z.string().url(),
  anchorAt: z.string().datetime()
});

export const notificationJobPayloadSchema = z.discriminatedUnion("trigger", [
  subscriptionDueJobPayloadSchema,
  paymentStatusJobPayloadSchema,
  paymentLinkCreatedJobPayloadSchema,
  catalogLinkCreatedJobPayloadSchema,
  tokenizationLinkCreatedJobPayloadSchema
]);

export type NotificationJobPayload = z.infer<typeof notificationJobPayloadSchema>;
export type SubscriptionDueJobPayload = z.infer<typeof subscriptionDueJobPayloadSchema>;
export type PaymentStatusJobPayload = z.infer<typeof paymentStatusJobPayloadSchema>;
export type PaymentLinkCreatedJobPayload = z.infer<typeof paymentLinkCreatedJobPayloadSchema>;
export type CatalogLinkCreatedJobPayload = z.infer<typeof catalogLinkCreatedJobPayloadSchema>;
export type TokenizationLinkCreatedJobPayload = z.infer<typeof tokenizationLinkCreatedJobPayloadSchema>;
