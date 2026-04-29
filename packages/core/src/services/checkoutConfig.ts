import { z } from "zod";

export const checkoutConfigSchema = z
  .object({
    planBaseUrl: z.string().optional(),
    subscriptionBaseUrl: z.string().optional(),
    cartBaseUrl: z.string().optional(),
    tokenExpiryHours: z.number().int().positive().max(168).optional(),
    tokenizationReturnUrl: z.string().optional(),
    defaultUtmParams: z.string().optional(),
    timeZone: z.string().optional(),
    timezone: z.string().optional(),
    defaultPlanTemplateId: z.string().optional(),
    defaultSubscriptionTemplateId: z.string().optional(),
    defaultCartTemplateId: z.string().optional()
  })
  .passthrough();

export type CheckoutConfig = z.infer<typeof checkoutConfigSchema>;

export function readCheckoutConfig(raw: string | null | undefined): CheckoutConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    const result = checkoutConfigSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}
