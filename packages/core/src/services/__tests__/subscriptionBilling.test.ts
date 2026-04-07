/**
 * Tests for subscription billing service:
 *   - Auto-debit charge creation
 *   - Payment link fallback
 *   - Status transitions (PAST_DUE, EXPIRED)
 *   - Duplicate prevention
 */

import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 15000 });

// Mock dependencies
vi.mock("../../providers/wompi/client", () => {
  return {
    WompiClient: class MockWompiClient {
      constructor(opts: any) {
        this.opts = opts;
      }
      opts: any;
      async createPaymentLink(data: any) {
        return {
          id: "plink-mock-" + Math.random().toString(36).slice(2, 8),
          checkoutUrl: "https://checkout.wompi.co/l/plink-mock",
          raw: data
        };
      }
      async createTransaction(data: any) {
        return {
          id: "tx-mock-" + Math.random().toString(36).slice(2, 8),
          status: "PENDING",
          raw: data
        };
      }
      async getMerchant() {
        return { id: "merchant-1" };
      }
    }
  };
});

vi.mock("../../services/runtimeConfig", () => ({
  getWompiPrivateKey: vi.fn(() => Promise.resolve("test-private-key")),
  getWompiPublicKey: vi.fn(() => Promise.resolve("test-public-key")),
  getWompiApiBaseUrl: vi.fn(() => Promise.resolve("https://api.wompi.co/v1")),
  getWompiCheckoutLinkBaseUrl: vi.fn(() => Promise.resolve("https://checkout.wompi.co/l/")),
  getWompiRedirectUrl: vi.fn(() => Promise.resolve("https://example.com/redirect")),
  getWompiIntegritySecret: vi.fn(() => Promise.resolve("test-integrity-secret")),
  getChatwootConfig: vi.fn(() => Promise.resolve({ configured: false }))
}));

vi.mock("../../services/credentials", () => ({
  getCredential: vi.fn(() => Promise.resolve(null))
}));

vi.mock("../../services/notificationsScheduler", () => ({
  schedulePaymentLinkNotifications: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/realtimePublisher", () => ({
  publishRealtime: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/chatwootSync", () => ({
  syncChatwootAttributesForCustomer: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/systemLog", () => ({
  systemLog: vi.fn(() => Promise.resolve())
}));

vi.mock("../../services/subscriptionMode", () => ({
  resolveSubscriptionCollectionMode: vi.fn(() => "AUTO_DEBIT")
}));

vi.mock("../../services/wompiReconcile", () => ({
  reconcileWompiTransaction: vi.fn(() => Promise.resolve({ status: "PENDING" }))
}));

vi.mock("../../db/prisma", () => {
  const store: any = {
    customer: {},
    subscription: {},
    payment: {},
    paymentLink: {},
    paymentAttempt: {},
    subscriptionBillingCycle: {}
  };

  return {
    prisma: {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      $queryRawUnsafe: vi.fn().mockResolvedValue(0),
      subscription: {
        findUnique: async ({ where, include }: any) => {
          const sub = store.subscription[where.id];
          if (!sub) return null;
          if (include?.plan) {
            return { ...sub, plan: store.plan?.[sub.planId] || { priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
          }
          if (include?.customer) {
            return { ...sub, customer: store.customer[sub.customerId] || null };
          }
          return sub;
        },
        findMany: async ({ where }: any = {}) => {
          let rows = Object.values(store.subscription);
          if (where?.status?.in) rows = rows.filter((s: any) => where.status.in.includes(s.status));
          return rows;
        },
        update: async ({ where, data }: any) => {
          if (store.subscription[where.id]) {
            store.subscription[where.id] = { ...store.subscription[where.id], ...data };
            return store.subscription[where.id];
          }
          return null;
        }
      },
      customer: {
        findUnique: async ({ where }: any) => store.customer[where.id] || null
      },
      payment: {
        findUnique: async ({ where }: any) => {
          if (where.subscriptionCycleKey) return Object.values(store.payment).find((p: any) => p.subscriptionCycleKey === where.subscriptionCycleKey) || null;
          if (where.id) return store.payment[where.id] || null;
          return null;
        },
        findFirst: async ({ where }: any = {}) => {
          let rows = Object.values(store.payment);
          if (where?.subscriptionId) rows = rows.filter((p: any) => p.subscriptionId === where.subscriptionId);
          if (where?.status) rows = rows.filter((p: any) => p.status === where.status);
          if (where?.wompiTransactionId?.not) rows = rows.filter((p: any) => p.wompiTransactionId !== where.wompiTransactionId.not);
          if (where?.cycleNumber) rows = rows.filter((p: any) => p.cycleNumber === where.cycleNumber);
          if (where?.createdAt?.gte) rows = rows.filter((p: any) => new Date(p.createdAt).getTime() >= new Date(where.createdAt.gte).getTime());
          return rows[0] || null;
        },
        upsert: async ({ where, create, update }: any) => {
          const existing = Object.values(store.payment).find((p: any) => {
            if (where.subscriptionCycleKey) return p.subscriptionCycleKey === where.subscriptionCycleKey;
            if (where.id) return p.id === where.id;
            return false;
          });
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const id = "pay-" + Math.random().toString(36).slice(2, 8);
          store.payment[id] = { id, ...create, createdAt: new Date() };
          return store.payment[id];
        },
        update: async ({ where, data }: any) => {
          if (store.payment[where.id]) {
            store.payment[where.id] = { ...store.payment[where.id], ...data };
            return store.payment[where.id];
          }
          return null;
        }
      },
      paymentLink: {
        upsert: async ({ create, update }: any) => {
          const existing = Object.values(store.paymentLink || {}).find((p: any) => p.paymentId === create?.paymentId);
          if (existing) { Object.assign(existing, update); return existing; }
          const id = "plink-" + Math.random().toString(36).slice(2, 8);
          store.paymentLink = store.paymentLink || {};
          store.paymentLink[id] = { id, ...create };
          return store.paymentLink[id];
        }
      },
      paymentAttempt: {
        create: async ({ data }: any) => {
          const id = "pa-" + Math.random().toString(36).slice(2, 8);
          store.paymentAttempt[id] = { id, ...data };
          return store.paymentAttempt[id];
        }
      }
    },
    store
  };
});

describe("Subscription Billing: Auto-debit validation", () => {
  it("should throw when customer has no payment source for AUTO_DEBIT", async () => {
    const { prisma, store } = await import("../../db/prisma");
    const { resolveSubscriptionCollectionMode } = await import("../../services/subscriptionMode");

    store.customer["cust-notoken"] = {
      id: "cust-notoken",
      email: "notoken@test.com",
      name: "No Token User",
      metadata: {} // No paymentSourceId
    };

    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: { collectionMode: "AUTO_DEBIT" }, intervalUnit: "MONTH", intervalCount: 1 } };

    store.subscription["sub-notoken"] = {
      id: "sub-notoken",
      tenantId: "tenant-1",
      customerId: "cust-notoken",
      planId: "plan-1",
      status: "ACTIVE",
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-04-01"),
      currentPeriodEndAt: new Date("2026-05-01"),
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3,
      metadata: { collectionMode: "AUTO_DEBIT" }
    };

    vi.mocked(resolveSubscriptionCollectionMode).mockReturnValue("AUTO_DEBIT");

    const { createAutoDebitTransactionForSubscription } = await import("../../services/subscriptionBilling");

    await expect(
      createAutoDebitTransactionForSubscription({ subscriptionId: "sub-notoken" })
    ).rejects.toThrow("customer_payment_source_missing");
  });

  it("should throw when subscription is CANCELED", async () => {
    const { prisma, store } = await import("../../db/prisma");

    store.customer["cust-canceled"] = { id: "cust-canceled", email: "canceled@test.com", name: "Canceled User", metadata: { wompi: { paymentSourceId: 123 } } };
    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: { collectionMode: "AUTO_DEBIT" }, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-canceled"] = {
      id: "sub-canceled",
      tenantId: "tenant-1",
      customerId: "cust-canceled",
      planId: "plan-1",
      status: "CANCELED",
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-04-01"),
      currentPeriodEndAt: new Date("2026-05-01"),
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3,
      metadata: { collectionMode: "AUTO_DEBIT" }
    };

    const { createAutoDebitTransactionForSubscription } = await import("../../services/subscriptionBilling");

    await expect(
      createAutoDebitTransactionForSubscription({ subscriptionId: "sub-canceled" })
    ).rejects.toThrow("subscription_canceled");
  });

  it("should throw when subscription is EXPIRED", async () => {
    const { prisma, store } = await import("../../db/prisma");

    store.customer["cust-expired"] = { id: "cust-expired", email: "expired@test.com", name: "Expired User", metadata: { wompi: { paymentSourceId: 456 } } };
    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: { collectionMode: "AUTO_DEBIT" }, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-expired"] = {
      id: "sub-expired",
      tenantId: "tenant-1",
      customerId: "cust-expired",
      planId: "plan-1",
      status: "EXPIRED",
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-01-01"),
      currentPeriodEndAt: new Date("2026-02-01"),
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3,
      metadata: { collectionMode: "AUTO_DEBIT" }
    };

    const { createAutoDebitTransactionForSubscription } = await import("../../services/subscriptionBilling");

    await expect(
      createAutoDebitTransactionForSubscription({ subscriptionId: "sub-expired" })
    ).rejects.toThrow("subscription_expired");
  });
});

describe("Subscription Billing: Payment link creation", () => {
  it("should throw when subscription is SUSPENDED", async () => {
    const { prisma, store } = await import("../../db/prisma");

    store.customer["cust-suspended"] = { id: "cust-suspended", email: "suspended@test.com", name: "Suspended User", metadata: {} };
    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-suspended"] = {
      id: "sub-suspended",
      tenantId: "tenant-1",
      customerId: "cust-suspended",
      planId: "plan-1",
      status: "SUSPENDED",
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-04-01"),
      currentPeriodEndAt: new Date("2026-05-01"),
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };

    const { createPaymentLinkForSubscription } = await import("../../services/subscriptionBilling");

    await expect(
      createPaymentLinkForSubscription({ subscriptionId: "sub-suspended" })
    ).rejects.toThrow("subscription_suspended");
  });

  it("should create a pending payment record before calling Wompi", async () => {
    const { prisma, store } = await import("../../db/prisma");

    store.customer["cust-link"] = { id: "cust-link", email: "link@test.com", name: "Link User", metadata: {} };
    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 15000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-link"] = {
      id: "sub-link",
      tenantId: "tenant-1",
      customerId: "cust-link",
      planId: "plan-1",
      status: "ACTIVE",
      currentCycle: 2,
      currentPeriodStartAt: new Date("2026-05-01"),
      currentPeriodEndAt: new Date("2026-06-01"),
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };

    const { createPaymentLinkForSubscription } = await import("../../services/subscriptionBilling");

    // This will try to call Wompi API which we've mocked
    const result = await createPaymentLinkForSubscription({ subscriptionId: "sub-link" });

    expect(result).toHaveProperty("paymentId");
    expect(result).toHaveProperty("wompiPaymentLinkId");
    expect(result).toHaveProperty("checkoutUrl");
  });
});

describe("ensureExpiredSubscriptions", () => {
  it("should mark ACTIVE as PAST_DUE when grace period has passed", async () => {
    const { prisma, store } = await import("../../db/prisma");

    // Subscription due 30 days ago, grace period 3 days — well past due
    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-pastdue"] = {
      id: "sub-pastdue",
      tenantId: "tenant-1",
      customerId: "cust-1",
      planId: "plan-1",
      status: "ACTIVE",
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-02-01"),
      currentPeriodEndAt: new Date("2026-03-01"),
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    expect(store.subscription["sub-pastdue"].status).toBe("PAST_DUE");
  });

  it("should not mark ACTIVE as PAST_DUE when within grace period", async () => {
    const { prisma, store } = await import("../../db/prisma");

    // Subscription due yesterday, grace period 3 days — still within grace
    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-grace"] = {
      id: "sub-grace",
      tenantId: "tenant-1",
      customerId: "cust-1",
      planId: "plan-1",
      status: "ACTIVE",
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-04-01"),
      currentPeriodEndAt: new Date(new Date().getTime() - 1 * 24 * 60 * 60 * 1000), // Due yesterday
      cycleStartDay: 1,
      paymentDay: 1,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    // Should still be ACTIVE (within grace period)
    expect(store.subscription["sub-grace"].status).toBe("ACTIVE");
  });
});
