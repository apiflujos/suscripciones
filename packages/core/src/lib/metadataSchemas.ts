import { z } from "zod";

export const planMetadataSchema = z.object({
  collectionMode: z.enum(["MANUAL_LINK", "AUTO_LINK", "AUTO_DEBIT"]).default("MANUAL_LINK"),
  pricing: z.object({
    totalInCents: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    shippingInCents: z.number().int().nonnegative().optional(),
    discountType: z.string().optional(),
    discountValueInCents: z.number().int().nonnegative().optional(),
    discountPercent: z.number().nonnegative().optional(),
  }).optional(),
  manualCharge: z.object({
    cycle: z.number().optional(),
    at: z.string().optional(), // ISO date
  }).optional(),
}).passthrough();

export type PlanMetadata = z.infer<typeof planMetadataSchema>;

export const subscriptionMetadataSchema = z.object({
  templateId: z.string().uuid().optional(),
  pricing: z.object({
    totalInCents: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
  }).optional(),
  manualCharge: z.object({
    cycle: z.number().int().optional(),
    at: z.string().optional(), // ISO date
  }).optional(),
}).passthrough();

export type SubscriptionMetadata = z.infer<typeof subscriptionMetadataSchema>;

export function getSubscriptionPricingTotal(metadata: unknown, fallback: number): number {
  const parsed = subscriptionMetadataSchema.safeParse(metadata);
  if (!parsed.success) return fallback;
  return parsed.data.pricing?.totalInCents ?? fallback;
}

export function getPlanPricingTotal(metadata: unknown, fallback: number): number {
  const parsed = planMetadataSchema.safeParse(metadata);
  if (!parsed.success) return fallback;
  return parsed.data.pricing?.totalInCents ?? fallback;
}

export function getExpectedSubscriptionTotalInCents(args: {
  subscriptionMetadata?: unknown;
  planMetadata?: unknown;
  fallback: number;
}): number {
  const fromSubscription = getSubscriptionPricingTotal(args.subscriptionMetadata, Number.NaN);
  if (Number.isFinite(fromSubscription) && fromSubscription >= 0) return Math.trunc(fromSubscription);

  const fromPlan = getPlanPricingTotal(args.planMetadata, Number.NaN);
  if (Number.isFinite(fromPlan) && fromPlan >= 0) return Math.trunc(fromPlan);

  return Math.max(0, Math.trunc(Number(args.fallback || 0)));
}

export function getPlanCollectionMode(metadata: unknown): "MANUAL_LINK" | "AUTO_LINK" | "AUTO_DEBIT" {
  const parsed = planMetadataSchema.safeParse(metadata);
  if (!parsed.success) return "MANUAL_LINK";
  return parsed.data.collectionMode;
}
