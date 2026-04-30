import { z } from "zod";

export const customerWompiPaymentSourceSchema = z.object({
  id: z.number(),
  type: z.string(),
  createdAt: z.string().optional()
});

export const customerTokenizationLinkSchema = z.object({
  token: z.string().optional(),
  url: z.string().optional(),
  returnUrl: z.string().optional().nullable(),
  expiresAt: z.string().datetime().optional(),
  usedAt: z.string().datetime().optional().nullable(),
  templateId: z.string().optional(),
  planId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  kind: z.string().optional(),
  tenantId: z.string().optional().nullable(),
  subscriptionId: z.string().optional().nullable(),
  createdAt: z.string().optional(),
  utmParams: z.string().optional().nullable()
});

export const customerWompiMetadataSchema = z.object({
  paymentSourceId: z.number().optional().nullable(),
  paymentSourceType: z.string().optional().nullable(),
  paymentSources: z.array(customerWompiPaymentSourceSchema).optional(),
  acceptancePermalink: z.string().optional(),
  personalDataPermalink: z.string().optional(),
  createdAt: z.string().datetime().optional()
});

export const customerMetadataSchema = z
  .object({
    identificacion: z.string().optional(),
    identificacionNumero: z.string().optional(),
    identificationNumber: z.string().optional(),
    documentNumber: z.string().optional(),
    document: z.string().optional(),
    documento: z.string().optional(),
    tokenizationLink: customerTokenizationLinkSchema.optional(),
    paymentLink: z
      .object({
        token: z.string().optional(),
        url: z.string().optional(),
        checkoutUrl: z.string().optional().nullable(),
        templateId: z.string().optional(),
        templateName: z.string().optional(),
        tenantId: z.string().optional().nullable(),
        kind: z.string().optional(),
        createdAt: z.string().optional(),
        expiresAt: z.string().optional(),
        usedAt: z.string().optional().nullable(),
        utmParams: z.string().optional().nullable()
      })
      .optional(),
    cartLink: z
      .object({
        token: z.string().optional(),
        url: z.string().optional(),
        templateId: z.string().optional(),
        tenantId: z.string().optional().nullable(),
        kind: z.string().optional(),
        createdAt: z.string().optional(),
        expiresAt: z.string().optional(),
        usedAt: z.string().optional().nullable(),
        utmParams: z.string().optional().nullable()
      })
      .optional(),
    wompi: customerWompiMetadataSchema.optional(),
    chatwoot: z
      .object({
        contactId: z.number().optional(),
        sourceId: z.string().optional(),
        attributesSyncedAt: z.string().datetime().optional()
      })
      .optional()
  })
  .passthrough();

export type CustomerMetadata = z.infer<typeof customerMetadataSchema>;
export type CustomerTokenizationLink = z.infer<typeof customerTokenizationLinkSchema>;
export type CustomerWompiMetadata = z.infer<typeof customerWompiMetadataSchema>;
export type CustomerWompiPaymentSource = z.infer<typeof customerWompiPaymentSourceSchema>;

export function readCustomerMetadata(value: unknown): CustomerMetadata {
  const parsed = customerMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function extractCustomerPaymentSourceId(value: unknown): number | null {
  const meta = readCustomerMetadata(value);
  const rawMeta = meta as Record<string, unknown>;
  const rawWompi =
    meta.wompi && typeof meta.wompi === "object"
      ? (meta.wompi as Record<string, unknown>)
      : null;
  const candidates = [
    meta.wompi?.paymentSourceId,
    rawWompi?.payment_source_id,
    meta.paymentSourceId,
    rawMeta.payment_source_id
  ];
  for (const entry of candidates) {
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (typeof entry === "string" && /^\d+$/.test(entry.trim())) return Number(entry.trim());
  }
  return null;
}
