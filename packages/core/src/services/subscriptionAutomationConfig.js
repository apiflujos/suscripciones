"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEffectiveSubscriptionAutomationConfig = resolveEffectiveSubscriptionAutomationConfig;
exports.resolveEffectiveSubscriptionAutomationConfigById = resolveEffectiveSubscriptionAutomationConfigById;
const prisma_1 = require("../db/prisma");
const runtimeConfig_1 = require("./runtimeConfig");
function asRecord(input) {
    return input && typeof input === "object" ? input : {};
}
function readOverrides(metadata) {
    const meta = asRecord(metadata);
    const nested = asRecord(meta.billingOverrides);
    const legacy = asRecord(meta.billing);
    return {
        chargeAtCutoffEnabled: nested.chargeAtCutoffEnabled ?? legacy.chargeAtCutoffEnabled,
        allowManualCharge: nested.allowManualCharge ?? legacy.allowManualCharge,
        executionHour: nested.executionHour ?? legacy.executionHour,
        timeZone: nested.timeZone ?? nested.timezone ?? legacy.timeZone ?? legacy.timezone,
        retryEnabled: nested.retryEnabled ?? legacy.retryEnabled,
        retryEveryValue: nested.retryEveryValue ?? legacy.retryEveryValue,
        retryEveryUnit: nested.retryEveryUnit ?? legacy.retryEveryUnit,
        retryEveryMinutes: nested.retryEveryMinutes ?? legacy.retryEveryMinutes,
        maxRetries: nested.maxRetries ?? legacy.maxRetries,
        graceDays: nested.graceDays ?? legacy.graceDays
    };
}
function toBoolOrDefault(value, fallback) {
    if (typeof value === "boolean")
        return value;
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw)
        return fallback;
    if (["1", "true", "yes", "on", "si", "sí"].includes(raw))
        return true;
    if (["0", "false", "no", "off"].includes(raw))
        return false;
    return fallback;
}
function toClockTimeOrDefault(value, fallback) {
    const raw = String(value ?? "").trim();
    return raw || fallback;
}
function toIntInRange(value, fallback, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num))
        return fallback;
    return Math.max(min, Math.min(max, Math.trunc(num)));
}
async function resolveEffectiveSubscriptionAutomationConfig(subscription) {
    const base = await (0, runtimeConfig_1.getAutoDebitConfig)();
    if (!subscription)
        return base;
    const overrides = readOverrides(subscription.metadata);
    const retryEveryMinutesFromOverride = overrides.retryEveryValue != null && overrides.retryEveryUnit
        ? undefined
        : overrides.retryEveryMinutes;
    return {
        enabled: base.enabled,
        chargeAtCutoffEnabled: toBoolOrDefault(overrides.chargeAtCutoffEnabled, base.chargeAtCutoffEnabled),
        allowManualCharge: toBoolOrDefault(overrides.allowManualCharge, base.allowManualCharge),
        executionHour: toClockTimeOrDefault(overrides.executionHour, base.executionHour),
        timeZone: toClockTimeOrDefault(overrides.timeZone, base.timeZone),
        retryEnabled: toBoolOrDefault(overrides.retryEnabled, base.retryEnabled),
        retryEveryValue: toIntInRange(overrides.retryEveryValue, base.retryEveryValue, 1, 10080),
        retryEveryUnit: (String(overrides.retryEveryUnit || "").trim().toUpperCase() === "HOURS"
            ? "HOURS"
            : String(overrides.retryEveryUnit || "").trim().toUpperCase() === "DAYS"
                ? "DAYS"
                : base.retryEveryUnit),
        retryEveryMinutes: toIntInRange(retryEveryMinutesFromOverride, base.retryEveryMinutes, 1, 10080),
        maxRetries: toIntInRange(overrides.maxRetries ?? subscription.maxRetries, base.maxRetries, 0, 20),
        graceDays: toIntInRange(overrides.graceDays ?? subscription.graceDays, base.graceDays, 1, 30)
    };
}
async function resolveEffectiveSubscriptionAutomationConfigById(subscriptionId) {
    const subscription = await prisma_1.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: { metadata: true, graceDays: true, maxRetries: true }
    });
    return resolveEffectiveSubscriptionAutomationConfig(subscription);
}
