import { describe, expect, it, vi } from "vitest";

let saved = { retryEnabled: true, retryEveryValue: 1, retryEveryUnit: "DAYS", maxRetries: 1, graceDays: 5 };

vi.mock("../credentials", () => ({
  getCredential: vi.fn(async (_p: unknown, key: string) => (key === "AUTO_DEBIT_CONFIG" ? JSON.stringify(saved) : undefined)),
  getCredentialsBulk: vi.fn(async () => new Map())
}));
vi.mock("../../db/prisma", () => ({ prisma: {} }));

import { resolveEffectiveSubscriptionAutomationConfig } from "../subscriptionAutomationConfig";
import { maxAttemptsPerCycle } from "../collectionAttempts";

// Una suscripción como las que dejan el esquema y los seeds.
const subscription = { maxRetries: 3, graceDays: 1, metadata: { billingOverrides: { maxRetries: 9, retryEnabled: false } } };

describe("Ajustes es la única fuente de las reglas de cobro", () => {
  it("la suscripción no puede contradecir lo configurado", async () => {
    const config = await resolveEffectiveSubscriptionAutomationConfig(subscription);
    expect(config).toMatchObject({ retryEnabled: true, maxRetries: 1, graceDays: 5 });
    expect(maxAttemptsPerCycle(config)).toBe(2);
  });

  it("si en Ajustes se cambia el máximo, el cobro lo sigue", async () => {
    saved = { ...saved, maxRetries: 4 };
    await expect(resolveEffectiveSubscriptionAutomationConfig(subscription)).resolves.toMatchObject({ maxRetries: 4 });
  });
});
