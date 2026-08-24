"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genericPayloadSchema = exports.forwardToShopifySchema = exports.paymentRetrySchema = exports.processWompiEventSchema = void 0;
const zod_1 = require("zod");
exports.processWompiEventSchema = zod_1.z.object({
    webhookEventId: zod_1.z.string().uuid()
});
exports.paymentRetrySchema = zod_1.z.object({
    subscriptionId: zod_1.z.string().uuid()
});
exports.forwardToShopifySchema = zod_1.z.object({
    webhookEventId: zod_1.z.string().uuid()
});
exports.genericPayloadSchema = zod_1.z.record(zod_1.z.unknown());
