import { z } from "zod";

export const processWompiEventSchema = z.object({
  webhookEventId: z.string().uuid()
});

export const paymentRetrySchema = z.object({
  subscriptionId: z.string().uuid()
});

export const forwardToShopifySchema = z.object({
  webhookEventId: z.string().uuid()
});

export const genericPayloadSchema = z.record(z.unknown());
