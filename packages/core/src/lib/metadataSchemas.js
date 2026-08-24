"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionMetadataSchema = exports.planMetadataSchema = void 0;
exports.getSubscriptionPricingTotal = getSubscriptionPricingTotal;
exports.getPlanPricingTotal = getPlanPricingTotal;
exports.getExpectedSubscriptionTotalInCents = getExpectedSubscriptionTotalInCents;
exports.getPlanCollectionMode = getPlanCollectionMode;
const zod_1 = require("zod");
exports.planMetadataSchema = zod_1.z.object({
    collectionMode: zod_1.z.enum(["MANUAL_LINK", "AUTO_LINK", "AUTO_DEBIT"]).default("MANUAL_LINK"),
    pricing: zod_1.z.object({
        totalInCents: zod_1.z.number().int().nonnegative().optional(),
        currency: zod_1.z.string().length(3).optional(),
        shippingInCents: zod_1.z.number().int().nonnegative().optional(),
        discountType: zod_1.z.string().optional(),
        discountValueInCents: zod_1.z.number().int().nonnegative().optional(),
        discountPercent: zod_1.z.number().nonnegative().optional(),
    }).optional(),
    manualCharge: zod_1.z.object({
        cycle: zod_1.z.number().optional(),
        at: zod_1.z.string().optional(), // ISO date
    }).optional(),
}).passthrough();
exports.subscriptionMetadataSchema = zod_1.z.object({
    templateId: zod_1.z.string().uuid().optional(),
    pricing: zod_1.z.object({
        totalInCents: zod_1.z.number().int().nonnegative().optional(),
        currency: zod_1.z.string().length(3).optional(),
    }).optional(),
    manualCharge: zod_1.z.object({
        cycle: zod_1.z.number().int().optional(),
        at: zod_1.z.string().optional(), // ISO date
    }).optional(),
}).passthrough();
function getSubscriptionPricingTotal(metadata, fallback) {
    const parsed = exports.subscriptionMetadataSchema.safeParse(metadata);
    if (!parsed.success)
        return fallback;
    return parsed.data.pricing?.totalInCents ?? fallback;
}
function getPlanPricingTotal(metadata, fallback) {
    const parsed = exports.planMetadataSchema.safeParse(metadata);
    if (!parsed.success)
        return fallback;
    return parsed.data.pricing?.totalInCents ?? fallback;
}
function getExpectedSubscriptionTotalInCents(args) {
    const fromSubscription = getSubscriptionPricingTotal(args.subscriptionMetadata, Number.NaN);
    if (Number.isFinite(fromSubscription) && fromSubscription >= 0)
        return Math.trunc(fromSubscription);
    const fromPlan = getPlanPricingTotal(args.planMetadata, Number.NaN);
    if (Number.isFinite(fromPlan) && fromPlan >= 0)
        return Math.trunc(fromPlan);
    return Math.max(0, Math.trunc(Number(args.fallback || 0)));
}
function getPlanCollectionMode(metadata) {
    const parsed = exports.planMetadataSchema.safeParse(metadata);
    if (!parsed.success)
        return "MANUAL_LINK";
    return parsed.data.collectionMode;
}
