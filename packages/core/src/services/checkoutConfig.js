"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutConfigSchema = void 0;
exports.readCheckoutConfig = readCheckoutConfig;
const zod_1 = require("zod");
exports.checkoutConfigSchema = zod_1.z
    .object({
    planBaseUrl: zod_1.z.string().optional(),
    subscriptionBaseUrl: zod_1.z.string().optional(),
    cartBaseUrl: zod_1.z.string().optional(),
    tokenExpiryHours: zod_1.z.number().int().positive().max(168).optional(),
    tokenizationReturnUrl: zod_1.z.string().optional(),
    defaultUtmParams: zod_1.z.string().optional(),
    timeZone: zod_1.z.string().optional(),
    timezone: zod_1.z.string().optional(),
    defaultPlanTemplateId: zod_1.z.string().optional(),
    defaultSubscriptionTemplateId: zod_1.z.string().optional(),
    defaultCartTemplateId: zod_1.z.string().optional()
})
    .passthrough();
function readCheckoutConfig(raw) {
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(String(raw));
        const result = exports.checkoutConfigSchema.safeParse(parsed);
        return result.success ? result.data : {};
    }
    catch {
        return {};
    }
}
