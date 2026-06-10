import { prisma } from "../db/prisma";
import { getAutoDebitConfig, type AutoDebitConfig } from "./runtimeConfig";

type SubscriptionAutomationLike = {
  metadata?: unknown;
  graceDays?: number | null;
  maxRetries?: number | null;
};

type AutomationOverrides = Partial<Pick<
  AutoDebitConfig,
  | "chargeAtCutoffEnabled"
  | "allowManualCharge"
  | "executionHour"
  | "timeZone"
  | "retryEnabled"
  | "retryEveryValue"
  | "retryEveryUnit"
  | "retryEveryMinutes"
  | "maxRetries"
  | "graceDays"
>>;

function asRecord(input: unknown): Record<string, any> {
  return input && typeof input === "object" ? (input as Record<string, any>) : {};
}

function readOverrides(metadata: unknown): AutomationOverrides {
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

function toBoolOrDefault(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "si", "sí"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function toClockTimeOrDefault(value: unknown, fallback: string) {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

function toIntInRange(value: unknown, fallback: number, min: number, max: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

export async function resolveEffectiveSubscriptionAutomationConfig(
  subscription: SubscriptionAutomationLike | null | undefined
): Promise<AutoDebitConfig> {
  const base = await getAutoDebitConfig();
  if (!subscription) return base;

  const overrides = readOverrides(subscription.metadata);

  const retryEveryMinutesFromOverride =
    overrides.retryEveryValue != null && overrides.retryEveryUnit
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

export async function resolveEffectiveSubscriptionAutomationConfigById(subscriptionId: string): Promise<AutoDebitConfig> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { metadata: true, graceDays: true, maxRetries: true }
  });
  return resolveEffectiveSubscriptionAutomationConfig(subscription);
}
