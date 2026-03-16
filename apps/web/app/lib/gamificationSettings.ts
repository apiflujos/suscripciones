import { z } from "zod";
import { CredentialProvider } from "@prisma/client";
import { getCredential, setCredential } from "./credentials";
import { GAMIFICATION_PENALTIES, GAMIFICATION_WEIGHTS } from "./gamificationConfig";

const followupSchema = z.object({
  minutes: z.number().int().min(1).default(15),
  cooldownMinutes: z.number().int().min(1).default(120),
  maxAttempts: z.number().int().min(1).default(3),
  penaltyNoResponse: z.number().int().min(0).default(25)
});

const decaySchema = z.object({
  inactivityDays: z.number().int().min(1).default(30),
  perDay: z.number().int().min(0).default(2),
  maxPenalty: z.number().int().min(0).default(180)
});

const trendSchema = z.object({
  windowsHours: z.array(z.number().int().min(1)).default([24, 168, 720])
});

const weightBaseSchema = z.object({
  status: z.number().int().default(0),
  lifetime: z.number().int().default(0),
  reward: z.number().int().default(0)
});

const weightsSchema = z.object({
  paymentApproved: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.paymentApproved.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.paymentApproved.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.paymentApproved.reward),
    moneyScale: z.number().int().min(1).default(GAMIFICATION_WEIGHTS.paymentApproved.moneyScale)
  }).default({}),
  paymentFailed: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.paymentFailed.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.paymentFailed.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.paymentFailed.reward)
  }).default({}),
  subscriptionStarted: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionStarted.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionStarted.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionStarted.reward)
  }).default({}),
  subscriptionRenewed: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionRenewed.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionRenewed.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionRenewed.reward)
  }).default({}),
  subscriptionCanceled: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionCanceled.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionCanceled.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionCanceled.reward)
  }).default({}),
  subscriptionPastDue: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionPastDue.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionPastDue.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.subscriptionPastDue.reward)
  }).default({}),
  chatwootMessageIn: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.chatwootMessageIn.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.chatwootMessageIn.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.chatwootMessageIn.reward)
  }).default({}),
  dataEmailAdded: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.dataEmailAdded.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.dataEmailAdded.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.dataEmailAdded.reward)
  }).default({}),
  dataPhoneAdded: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.dataPhoneAdded.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.dataPhoneAdded.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.dataPhoneAdded.reward)
  }).default({}),
  dataIdAdded: weightBaseSchema.extend({
    status: z.number().int().default(GAMIFICATION_WEIGHTS.dataIdAdded.status),
    lifetime: z.number().int().default(GAMIFICATION_WEIGHTS.dataIdAdded.lifetime),
    reward: z.number().int().default(GAMIFICATION_WEIGHTS.dataIdAdded.reward)
  }).default({})
}).default({});

const penaltiesSchema = z.object({
  pastDue: z.number().int().min(0).default(GAMIFICATION_PENALTIES.pastDue),
  canceled: z.number().int().min(0).default(GAMIFICATION_PENALTIES.canceled)
}).default({});

const gamificationConfigSchema = z.object({
  version: z.number().int().default(1),
  followup: followupSchema.default({}),
  decay: decaySchema.default({}),
  trends: trendSchema.default({}),
  weights: weightsSchema.default({}),
  penalties: penaltiesSchema.default({})
});

export type GamificationConfig = z.infer<typeof gamificationConfigSchema>;

function defaultConfig(): GamificationConfig {
  return gamificationConfigSchema.parse({});
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; value: GamificationConfig } | null = null;

export async function getGamificationConfig(): Promise<GamificationConfig> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const raw = (await getCredential(CredentialProvider.GAMIFICATION, "CONFIG")) || "";
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
  } catch {
    const cfg = defaultConfig();
    cache = { at: now, value: cfg };
    return cfg;
  }
}

export async function setGamificationConfig(input: unknown) {
  const cfg = gamificationConfigSchema.parse(input ?? {});
  await setCredential(CredentialProvider.GAMIFICATION, "CONFIG", JSON.stringify(cfg));
  cache = { at: Date.now(), value: cfg };
  return cfg;
}

export function clearGamificationConfigCache() {
  cache = null;
}
