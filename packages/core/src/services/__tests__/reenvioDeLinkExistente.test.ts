/**
 * El día de cobro el link ya existía (lo creó el recordatorio) y no se enviaba.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  recentMessage: vi.fn(),
  createAttempt: vi.fn(),
  notify: vi.fn(),
  payment: {
    id: "pay-1",
    status: "PENDING",
    checkoutUrl: "https://checkout.wompi.co/l/abc",
    wompiPaymentLinkId: "abc",
    amountInCents: 10000
  }
}));

vi.mock("../../db/prisma", () => ({
  prisma: {
    subscription: {
      findUnique: vi.fn().mockResolvedValue({
        id: "sub-1",
        tenantId: "t-1",
        customerId: "cus-1",
        planId: "plan-1",
        status: "PAST_DUE",
        metadata: {},
        customer: {},
        plan: { currency: "COP", priceInCents: 10000, metadata: {} },

      })
    },
    payment: { findUnique: vi.fn().mockResolvedValue(db.payment), upsert: vi.fn().mockResolvedValue(db.payment) },
    paymentLink: { upsert: vi.fn().mockResolvedValue({}) },
    paymentAttempt: { create: db.createAttempt },
    chatwootMessage: { findFirst: db.recentMessage },
    publicCheckoutTemplate: {
      findMany: vi.fn().mockResolvedValue([{ id: "tpl-1", active: true, kind: "PLAN" }]),
      findUnique: vi.fn().mockResolvedValue(null)
    }
  }
}));
vi.mock("../billingCycles", () => ({
  isBillingCyclePaid: () => false,
  resolveSubscriptionBillingState: vi.fn().mockResolvedValue({ collectionCycle: { cycleNumber: 2 } })
}));
vi.mock("../notificationsConfig", () => ({
  getNotificationsConfig: vi.fn().mockResolvedValue({
    rules: [{ id: "r", enabled: true, trigger: "PAYMENT_LINK_CREATED", templateId: "t" }],
    templates: [{ id: "t", channel: "CHATWOOT", chatwootTemplate: { name: "link" } }]
  }),
  resolveNotificationTemplate: vi.fn(() => ({ channel: "CHATWOOT", chatwootTemplate: { name: "link" } }))
}));
vi.mock("../publicCheckoutLinks", () => ({
  createPublicCheckoutLink: vi.fn().mockResolvedValue({ url: "https://pago.example/x" }),
  persistPublicPaymentLinkForPayment: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("../notificationsScheduler", () => ({ schedulePaymentLinkNotifications: db.notify }));
vi.mock("../runtimeConfig", () => ({ getChatwootConfig: vi.fn().mockResolvedValue({ configured: false }) }));
vi.mock("../chatwootSync", () => ({ syncChatwootAttributesForCustomer: vi.fn() }));
vi.mock("../systemLog", () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../credentials", () => ({ getCredential: vi.fn().mockResolvedValue("{}") }));
vi.mock("../checkoutConfig", () => ({ readCheckoutConfig: () => ({ defaultPlanTemplateId: "tpl-1" }) }));

import { createPaymentLinkForSubscription } from "../subscriptionBilling";

describe("link de pago que ya existe", () => {
  beforeEach(() => {
    db.recentMessage.mockReset().mockResolvedValue(null);
    db.createAttempt.mockReset().mockResolvedValue({});
    db.notify.mockReset().mockResolvedValue({ scheduled: 0, sentNow: 1, rulesActive: true, errors: [] });
  });

  it("se reenvía y queda contado como intento", async () => {
    const result = await createPaymentLinkForSubscription({ subscriptionId: "sub-1", resendIfExists: true });
    expect(db.notify).toHaveBeenCalledOnce();
    expect(result.notificationsSent).toBe(1);
    expect(db.createAttempt.mock.calls[0][0].data.status).toBe("PAYMENT_LINK_RESENT");
  });

  it("no se duplica si salió hace poco", async () => {
    db.recentMessage.mockResolvedValue({ id: "msg-1" });
    const result = await createPaymentLinkForSubscription({ subscriptionId: "sub-1", resendIfExists: true });
    expect(db.notify).not.toHaveBeenCalled();
    expect(result.alreadySentRecently).toBe(true);
  });

  it("sin pedirlo, no envía nada", async () => {
    await createPaymentLinkForSubscription({ subscriptionId: "sub-1" });
    expect(db.notify).not.toHaveBeenCalled();
    expect(db.createAttempt).not.toHaveBeenCalled();
  });
});
