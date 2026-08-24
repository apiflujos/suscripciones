"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGamificationConfig = getGamificationConfig;
exports.setGamificationConfig = setGamificationConfig;
exports.clearGamificationConfigCache = clearGamificationConfigCache;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const credentials_1 = require("./credentials");
const gamificationConfig_1 = require("./gamificationConfig");
const followupSchema = zod_1.z.object({
    minutes: zod_1.z.number().int().min(1).default(15),
    cooldownMinutes: zod_1.z.number().int().min(1).default(120),
    maxAttempts: zod_1.z.number().int().min(1).default(3),
    penaltyNoResponse: zod_1.z.number().int().min(0).default(25)
});
const decaySchema = zod_1.z.object({
    inactivityDays: zod_1.z.number().int().min(1).default(30),
    perDay: zod_1.z.number().int().min(0).default(2),
    maxPenalty: zod_1.z.number().int().min(0).default(180)
});
const trendSchema = zod_1.z.object({
    windowsHours: zod_1.z.array(zod_1.z.number().int().min(1)).default([24, 168, 720])
});
const weightBaseSchema = zod_1.z.object({
    status: zod_1.z.number().int().default(0),
    lifetime: zod_1.z.number().int().default(0),
    reward: zod_1.z.number().int().default(0)
});
const weightsSchema = zod_1.z.object({
    paymentApproved: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentApproved.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentApproved.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentApproved.reward),
        moneyScale: zod_1.z.number().int().min(1).default(gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentApproved.moneyScale)
    }).default({}),
    paymentFailed: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentFailed.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentFailed.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.paymentFailed.reward)
    }).default({}),
    subscriptionStarted: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionStarted.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionStarted.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionStarted.reward)
    }).default({}),
    subscriptionRenewed: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionRenewed.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionRenewed.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionRenewed.reward)
    }).default({}),
    subscriptionCanceled: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionCanceled.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionCanceled.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionCanceled.reward)
    }).default({}),
    subscriptionPastDue: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionPastDue.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionPastDue.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.subscriptionPastDue.reward)
    }).default({}),
    chatwootMessageIn: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.chatwootMessageIn.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.chatwootMessageIn.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.chatwootMessageIn.reward)
    }).default({}),
    dataEmailAdded: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataEmailAdded.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataEmailAdded.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataEmailAdded.reward)
    }).default({}),
    dataPhoneAdded: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataPhoneAdded.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataPhoneAdded.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataPhoneAdded.reward)
    }).default({}),
    dataIdAdded: weightBaseSchema.extend({
        status: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataIdAdded.status),
        lifetime: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataIdAdded.lifetime),
        reward: zod_1.z.number().int().default(gamificationConfig_1.GAMIFICATION_WEIGHTS.dataIdAdded.reward)
    }).default({})
}).default({});
const penaltiesSchema = zod_1.z.object({
    pastDue: zod_1.z.number().int().min(0).default(gamificationConfig_1.GAMIFICATION_PENALTIES.pastDue),
    canceled: zod_1.z.number().int().min(0).default(gamificationConfig_1.GAMIFICATION_PENALTIES.canceled)
}).default({});
const gamificationConfigSchema = zod_1.z.object({
    version: zod_1.z.number().int().default(1),
    followup: followupSchema.default({}),
    decay: decaySchema.default({}),
    trends: trendSchema.default({}),
    weights: weightsSchema.default({}),
    penalties: penaltiesSchema.default({})
});
function defaultConfig() {
    return gamificationConfigSchema.parse({});
}
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;
async function getGamificationConfig() {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS)
        return cache.value;
    const raw = (await (0, credentials_1.getCredential)(client_1.CredentialProvider.GAMIFICATION, "CONFIG")) || "";
    if (!raw) {
        const cfg = defaultConfig();
        cache = { at: now, value: cfg };
        return cfg;
    }
    try {
        const parsed = JSON.parse(raw);
        const cfg = gamificationConfigSchema.parse(parsed);
        cache = { at: now, value: cfg };
        return cfg;
    }
    catch {
        const cfg = defaultConfig();
        cache = { at: now, value: cfg };
        return cfg;
    }
}
async function setGamificationConfig(input) {
    const cfg = gamificationConfigSchema.parse(input ?? {});
    await (0, credentials_1.setCredential)(client_1.CredentialProvider.GAMIFICATION, "CONFIG", JSON.stringify(cfg));
    cache = { at: Date.now(), value: cfg };
    return cfg;
}
function clearGamificationConfigCache() {
    cache = null;
}
