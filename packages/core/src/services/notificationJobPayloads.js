"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationJobPayloadSchema = exports.tokenizationLinkCreatedJobPayloadSchema = exports.catalogLinkCreatedJobPayloadSchema = exports.paymentLinkCreatedJobPayloadSchema = exports.paymentStatusJobPayloadSchema = exports.subscriptionDueJobPayloadSchema = void 0;
const zod_1 = require("zod");
const notificationsConfig_1 = require("./notificationsConfig");
const uuidField = zod_1.z.preprocess((value) => {
    if (value == null)
        return undefined;
    const normalized = String(value || "").trim();
    return normalized || undefined;
}, zod_1.z.string().uuid().optional());
const baseNotificationJobPayloadSchema = zod_1.z.object({
    trigger: notificationsConfig_1.notificationTriggerSchema,
    ruleId: zod_1.z.string().min(1),
    offsetSeconds: zod_1.z.number().int().optional(),
    anchorAt: zod_1.z.string().datetime().optional(),
    customerId: uuidField,
    subscriptionId: uuidField,
    paymentId: uuidField,
    immediateSend: zod_1.z.boolean().optional()
});
exports.subscriptionDueJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
    trigger: zod_1.z.literal("SUBSCRIPTION_DUE"),
    customerId: zod_1.z.string().uuid(),
    subscriptionId: zod_1.z.string().uuid(),
    cycleNumber: zod_1.z.number().int().positive(),
    anchorAt: zod_1.z.string().datetime()
});
exports.paymentStatusJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
    trigger: zod_1.z.enum(["PAYMENT_APPROVED", "PAYMENT_DECLINED"]),
    customerId: zod_1.z.string().uuid(),
    paymentId: zod_1.z.string().uuid(),
    paymentStatus: zod_1.z.enum(["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"]),
    anchorAt: zod_1.z.string().datetime(),
    paymentType: zod_1.z.enum(["PLAN", "SUBSCRIPTION", "LINK"]).optional()
});
exports.paymentLinkCreatedJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
    trigger: zod_1.z.literal("PAYMENT_LINK_CREATED"),
    customerId: zod_1.z.string().uuid(),
    paymentId: zod_1.z.string().uuid(),
    anchorAt: zod_1.z.string().datetime(),
    paymentType: zod_1.z.enum(["PLAN", "SUBSCRIPTION", "LINK"]).optional(),
    paymentLinkUrl: zod_1.z.string().url().optional()
});
exports.catalogLinkCreatedJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
    trigger: zod_1.z.literal("CATALOG_LINK_CREATED"),
    customerId: zod_1.z.string().uuid(),
    catalogUrl: zod_1.z.string().url(),
    anchorAt: zod_1.z.string().datetime(),
    paymentType: zod_1.z.enum(["PLAN", "SUBSCRIPTION", "LINK"]).optional()
});
exports.tokenizationLinkCreatedJobPayloadSchema = baseNotificationJobPayloadSchema.extend({
    trigger: zod_1.z.literal("TOKENIZATION_LINK_CREATED"),
    customerId: zod_1.z.string().uuid(),
    tokenUrl: zod_1.z.string().url(),
    anchorAt: zod_1.z.string().datetime(),
    tenantId: uuidField,
    planId: uuidField,
    productId: uuidField
});
exports.notificationJobPayloadSchema = zod_1.z.discriminatedUnion("trigger", [
    exports.subscriptionDueJobPayloadSchema,
    exports.paymentStatusJobPayloadSchema,
    exports.paymentLinkCreatedJobPayloadSchema,
    exports.catalogLinkCreatedJobPayloadSchema,
    exports.tokenizationLinkCreatedJobPayloadSchema
]);
