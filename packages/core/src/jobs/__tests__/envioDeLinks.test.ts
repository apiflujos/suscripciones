/**
 * Casos que dejaron a clientes sin su link de pago: el link existente no se
 * reenviaba y un envío fallido quedaba como cobro procesado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createLink = vi.fn();
const findMessage = vi.fn();

vi.mock("../../services/subscriptionBilling", () => ({
  createPaymentLinkForSubscription: (args: unknown) => createLink(args),
  createAutoDebitTransactionForSubscription: vi.fn()
}));
vi.mock("../../db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    subscription: {
      findUnique: vi.fn().mockResolvedValue({
        id: "sub-1",
        status: "PAST_DUE",
        customerId: "cus-1",
        customer: { email: "a@b.co", metadata: {} },
        plan: { metadata: {} },
        metadata: {}
      })
    },
    payment: { findFirst: vi.fn().mockResolvedValue(null) },
    chatwootMessage: { findFirst: (args: unknown) => findMessage(args) }
  }
}));
vi.mock("../../services/billingCycles", () => ({
  resolveSubscriptionBillingState: vi.fn().mockResolvedValue({ collectionCycle: { cycleNumber: 2, dueAt: new Date(Date.now() - 60_000) } }),
  syncSubscriptionBillingSnapshot: vi.fn().mockResolvedValue(null)
}));
vi.mock("../../services/subscriptionMode", () => ({ resolveSubscriptionCollectionMode: () => "AUTO_LINK" }));
vi.mock("../../services/subscriptionAutomationConfig", () => ({
  resolveEffectiveSubscriptionAutomationConfig: vi.fn().mockResolvedValue({ retryEnabled: false, maxRetries: 0, retryEveryMinutes: 1440 })
}));
vi.mock("../../services/runtimeConfig", () => ({ getAutoDebitConfig: vi.fn() }));
vi.mock("../../services/collectionAttempts", () => ({ hasExhaustedCycleAttempts: vi.fn() }));
vi.mock("../../services/systemLog", () => ({ systemLog: vi.fn().mockResolvedValue(undefined), SystemActor: {} }));
vi.mock("../../services/realtimePublisher", () => ({ publishRealtime: vi.fn() }));

import { paymentRetry } from "../handlers/paymentRetry";

const link = (extra: Record<string, unknown>) => ({
  paymentId: "pay-1",
  notificationsSent: 0,
  notificationsRulesActive: true,
  chatwootError: null,
  ...extra
});
const run = () => paymentRetry({ subscriptionId: "sub-1" });

describe("cobro por link", () => {
  beforeEach(() => {
    createLink.mockReset();
    findMessage.mockReset().mockResolvedValue(null);
  });

  it("pide reenviar el link si ya existe", async () => {
    createLink.mockResolvedValue(link({ notificationsSent: 1 }));
    await expect(run()).resolves.toMatchObject({ status: "processed" });
    expect(createLink).toHaveBeenCalledWith({ subscriptionId: "sub-1", resendIfExists: true });
  });

  it("falla cuando el mensaje no sale", async () => {
    createLink.mockResolvedValue(link({ chatwootError: "422" }));
    await expect(run()).rejects.toThrow("payment_link_not_delivered:422");
  });

  it("no falla si el mensaje quedó aceptado y sin confirmar", async () => {
    createLink.mockResolvedValue(link({ chatwootError: "chatwoot_send_failed" }));
    findMessage.mockResolvedValue({ id: "msg-1" });
    await expect(run()).resolves.toMatchObject({ status: "processed" });
  });

  it("deja el motivo escrito si no hay regla de envío", async () => {
    createLink.mockResolvedValue(link({ notificationsRulesActive: false }));
    await expect(run()).resolves.toMatchObject({ reason: "link_not_sent_no_rule" });
  });

  it("no marca error cuando ya había salido hace poco", async () => {
    createLink.mockResolvedValue(link({ alreadySentRecently: true }));
    await expect(run()).resolves.toMatchObject({ status: "processed" });
  });
});
