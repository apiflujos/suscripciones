import { z } from "zod";
import { CredentialProvider } from "@prisma/client";
import { getCredential, setCredential } from "./credentials";

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

const gamificationConfigSchema = z.object({
  version: z.number().int().default(1),
  followup: followupSchema.default({}),
  decay: decaySchema.default({}),
  trends: trendSchema.default({})
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
