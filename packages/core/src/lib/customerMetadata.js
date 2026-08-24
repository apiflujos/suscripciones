"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerMetadataSchema = exports.customerWompiMetadataSchema = exports.customerTokenizationLinkSchema = exports.customerWompiPaymentSourceSchema = void 0;
exports.readCustomerMetadata = readCustomerMetadata;
exports.extractCustomerPaymentSourceId = extractCustomerPaymentSourceId;
exports.hasActiveCustomerPaymentSource = hasActiveCustomerPaymentSource;
const zod_1 = require("zod");
exports.customerWompiPaymentSourceSchema = zod_1.z.object({
    id: zod_1.z.number(),
    type: zod_1.z.string(),
    createdAt: zod_1.z.string().optional()
});
exports.customerTokenizationLinkSchema = zod_1.z.object({
    token: zod_1.z.string().optional(),
    url: zod_1.z.string().optional(),
    returnUrl: zod_1.z.string().optional().nullable(),
    expiresAt: zod_1.z.string().datetime().optional(),
    usedAt: zod_1.z.string().datetime().optional().nullable(),
    templateId: zod_1.z.string().optional(),
    planId: zod_1.z.string().optional().nullable(),
    productId: zod_1.z.string().optional().nullable(),
    kind: zod_1.z.string().optional(),
    tenantId: zod_1.z.string().optional().nullable(),
    subscriptionId: zod_1.z.string().optional().nullable(),
    createdAt: zod_1.z.string().optional(),
    utmParams: zod_1.z.string().optional().nullable()
});
exports.customerWompiMetadataSchema = zod_1.z.object({
    paymentSourceId: zod_1.z.number().optional().nullable(),
    paymentSourceType: zod_1.z.string().optional().nullable(),
    paymentSources: zod_1.z.array(exports.customerWompiPaymentSourceSchema).optional(),
    acceptancePermalink: zod_1.z.string().optional(),
    personalDataPermalink: zod_1.z.string().optional(),
    createdAt: zod_1.z.string().datetime().optional()
});
exports.customerMetadataSchema = zod_1.z
    .object({
    identificacion: zod_1.z.string().optional(),
    identificacionNumero: zod_1.z.string().optional(),
    identificationNumber: zod_1.z.string().optional(),
    documentNumber: zod_1.z.string().optional(),
    document: zod_1.z.string().optional(),
    documento: zod_1.z.string().optional(),
    tokenizationLink: exports.customerTokenizationLinkSchema.optional(),
    paymentLink: zod_1.z
        .object({
        token: zod_1.z.string().optional(),
        url: zod_1.z.string().optional(),
        checkoutUrl: zod_1.z.string().optional().nullable(),
        templateId: zod_1.z.string().optional(),
        templateName: zod_1.z.string().optional(),
        tenantId: zod_1.z.string().optional().nullable(),
        kind: zod_1.z.string().optional(),
        createdAt: zod_1.z.string().optional(),
        expiresAt: zod_1.z.string().optional(),
        usedAt: zod_1.z.string().optional().nullable(),
        utmParams: zod_1.z.string().optional().nullable()
    })
        .optional(),
    cartLink: zod_1.z
        .object({
        token: zod_1.z.string().optional(),
        url: zod_1.z.string().optional(),
        templateId: zod_1.z.string().optional(),
        tenantId: zod_1.z.string().optional().nullable(),
        kind: zod_1.z.string().optional(),
        createdAt: zod_1.z.string().optional(),
        expiresAt: zod_1.z.string().optional(),
        usedAt: zod_1.z.string().optional().nullable(),
        utmParams: zod_1.z.string().optional().nullable()
    })
        .optional(),
    wompi: exports.customerWompiMetadataSchema.optional(),
    chatwoot: zod_1.z
        .object({
        contactId: zod_1.z.number().optional(),
        sourceId: zod_1.z.string().optional(),
        attributesSyncedAt: zod_1.z.string().datetime().optional()
    })
        .optional()
})
    .passthrough();
function readCustomerMetadata(value) {
    const parsed = exports.customerMetadataSchema.safeParse(value);
    return parsed.success ? parsed.data : {};
}
function extractCustomerPaymentSourceId(value) {
    const meta = readCustomerMetadata(value);
    const rawMeta = meta;
    const rawWompi = meta.wompi && typeof meta.wompi === "object"
        ? meta.wompi
        : null;
    const candidates = [
        meta.wompi?.paymentSourceId,
        rawWompi?.payment_source_id,
        meta.paymentSourceId,
        rawMeta.payment_source_id
    ];
    for (const entry of candidates) {
        if (typeof entry === "number" && Number.isFinite(entry))
            return entry;
        if (typeof entry === "string" && /^\d+$/.test(entry.trim()))
            return Number(entry.trim());
    }
    return null;
}
function hasActiveCustomerPaymentSource(value) {
    return extractCustomerPaymentSourceId(value) !== null;
}
