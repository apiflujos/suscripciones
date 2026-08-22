/**
 * Tests for subscription billing service:
 *   - Auto-debit charge creation
 *   - Payment link fallback
 *   - Status transitions (PAST_DUE, EXPIRED)
 *   - Duplicate prevention
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

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

vi.mock("../../services/billingCycles", async () => ({
  isBillingCyclePaid: vi.fn((cycle: { status?: string | null } | null | undefined) => String(cycle?.status || "").toUpperCase() === "PAID"),
  resolveSubscriptionBillingState: vi.fn(async ({ subscriptionId }: { subscriptionId: string }) => {
    const { store } = await import("../../db/prisma");
    const subscription = store.subscription[subscriptionId];
    if (!subscription) return null;
    const plan = store.plan?.[subscription.planId] || null;
    const cycles = Object.values(store.subscriptionBillingCycle || {})
      .filter((cycle: any) => cycle.subscriptionId === subscriptionId)
      .sort((a: any, b: any) => Number(a.cycleNumber || 0) - Number(b.cycleNumber || 0));
    const now = Date.now();
    const activeCycle =
      cycles.find((cycle: any) => new Date(cycle.periodStartAt).getTime() <= now && now < new Date(cycle.periodEndAt).getTime()) ||
      cycles[cycles.length - 1] ||
      null;
    const paymentTiming = String(subscription.paymentTiming || "EN_CURSO").toUpperCase();
    const collectionCycle =
      paymentTiming === "ANTICIPADO"
        ? cycles.find((cycle: any) => Number(cycle.cycleNumber || 0) > Number(activeCycle?.cycleNumber || 0)) || null
        : activeCycle || null;
    return {
      subscription: { ...subscription, ...(plan ? { plan } : {}) },
      cycles,
      activeCycle,
      collectionCycle,
      oldestUnpaidCycle: cycles.find((cycle: any) => String(cycle?.status || "").toUpperCase() !== "PAID") || null
    };
  }),
  syncSubscriptionBillingSnapshot: vi.fn(async () => null)
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
      $transaction: async (input: any) => {
        if (typeof input === "function") return input((globalThis as any).__mockTx || {});
        if (Array.isArray(input)) return Promise.all(input);
        return input;
      },
      subscription: {
        findUnique: async ({ where, include }: any) => {
          const sub = store.subscription[where.id];
          if (!sub) return null;
          return {
            ...sub,
            ...(include?.plan
              ? { plan: store.plan?.[sub.planId] || { priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } }
              : {}),
            ...(include?.customer ? { customer: store.customer[sub.customerId] || null } : {})
          };
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
        count: async ({ where }: any = {}) => {
          let rows = Object.values(store.paymentAttempt);
          if (where?.paymentId) rows = rows.filter((p: any) => p.paymentId === where.paymentId);
          return rows.length;
        },
        create: async ({ data }: any) => {
          const id = "pa-" + Math.random().toString(36).slice(2, 8);
          store.paymentAttempt[id] = { id, ...data };
          return store.paymentAttempt[id];
        }
      },
      subscriptionBillingCycle: {
        findMany: async ({ where }: any = {}) => {
          let rows = Object.values(store.subscriptionBillingCycle);
          if (where?.subscriptionId) rows = rows.filter((c: any) => c.subscriptionId === where.subscriptionId);
          if (where?.paymentId === null) rows = rows.filter((c: any) => c.paymentId == null);
          if (where?.status?.not) rows = rows.filter((c: any) => c.status !== where.status.not);
          return rows;
        },
        upsert: async ({ where, create, update }: any) => {
          const key = where?.subscriptionId_cycleNumber;
          const existing = Object.values(store.subscriptionBillingCycle).find(
            (c: any) => c.subscriptionId === key.subscriptionId && c.cycleNumber === key.cycleNumber
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const id = "cycle-" + Math.random().toString(36).slice(2, 8);
          store.subscriptionBillingCycle[id] = { id, ...create };
          return store.subscriptionBillingCycle[id];
        }
      }
    },
    store
  };
});

function startOfMonthUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonthsUtc(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function seedCycle(store: any, input: {
  id: string;
  subscriptionId: string;
  cycleNumber: number;
  periodStartAt: Date;
  periodEndAt: Date;
  dueAt: Date;
  status?: string;
  paymentId?: string | null;
}) {
  store.subscriptionBillingCycle[input.id] = {
    paymentId: null,
    status: "PENDING",
    ...input
  };
}

describe("Subscription Billing: Auto-debit validation", () => {
  beforeEach(async () => {
    const { store } = await import("../../db/prisma");
    store.customer = {};
    store.plan = {};
    store.subscription = {};
    store.payment = {};
    store.paymentLink = {};
    store.paymentAttempt = {};
    store.subscriptionBillingCycle = {};
  });

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
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3,
      metadata: { collectionMode: "AUTO_DEBIT" }
    };
    seedCycle(store, {
      id: "cycle-notoken",
      subscriptionId: "sub-notoken",
      cycleNumber: 1,
      periodStartAt: new Date("2026-04-01"),
      periodEndAt: new Date("2026-05-01"),
      dueAt: new Date("2026-04-05")
    });

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
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3,
      metadata: { collectionMode: "AUTO_DEBIT" }
    };
    seedCycle(store, {
      id: "cycle-canceled",
      subscriptionId: "sub-canceled",
      cycleNumber: 1,
      periodStartAt: new Date("2026-04-01"),
      periodEndAt: new Date("2026-05-01"),
      dueAt: new Date("2026-04-05")
    });

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
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3,
      metadata: { collectionMode: "AUTO_DEBIT" }
    };
    seedCycle(store, {
      id: "cycle-expired",
      subscriptionId: "sub-expired",
      cycleNumber: 1,
      periodStartAt: new Date("2026-01-01"),
      periodEndAt: new Date("2026-02-01"),
      dueAt: new Date("2026-01-05")
    });

    const { createAutoDebitTransactionForSubscription } = await import("../../services/subscriptionBilling");

    await expect(
      createAutoDebitTransactionForSubscription({ subscriptionId: "sub-expired" })
    ).rejects.toThrow("subscription_expired");
  });

  it("should reuse the same payment row and create only one new transaction after a declined attempt", async () => {
    const { store } = await import("../../db/prisma");

    store.customer["cust-retry"] = {
      id: "cust-retry",
      email: "retry@test.com",
      name: "Retry User",
      metadata: { wompi: { paymentSourceId: 789 } }
    };

    store.plan = {
      "plan-1": {
        id: "plan-1",
        tenantId: "tenant-1",
        name: "Plan",
        priceInCents: 10000,
        currency: "COP",
        metadata: { collectionMode: "AUTO_DEBIT" },
        intervalUnit: "MONTH",
        intervalCount: 1
      }
    };

    store.subscription["sub-retry"] = {
      id: "sub-retry",
      tenantId: "tenant-1",
      customerId: "cust-retry",
      planId: "plan-1",
      status: "ACTIVE",
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3,
      metadata: { collectionMode: "AUTO_DEBIT" }
    };

    seedCycle(store, {
      id: "cycle-retry",
      subscriptionId: "sub-retry",
      cycleNumber: 1,
      periodStartAt: new Date("2026-04-01"),
      periodEndAt: new Date("2026-05-01"),
      dueAt: new Date("2026-04-05"),
      status: "PENDING"
    });

    store.payment["pay-retry"] = {
      id: "pay-retry",
      tenantId: "tenant-1",
      customerId: "cust-retry",
      subscriptionId: "sub-retry",
      amountInCents: 10000,
      currency: "COP",
      cycleNumber: 1,
      reference: "SUB_sub-retry_1",
      status: "DECLINED",
      wompiTransactionId: "tx-old",
      subscriptionCycleKey: "sub-retry:1",
      providerResponse: {}
    };

    const { createAutoDebitTransactionForSubscription } = await import("../../services/subscriptionBilling");

    const result = await createAutoDebitTransactionForSubscription({ subscriptionId: "sub-retry" });

    expect(result.paymentId).toBe("pay-retry");
    expect(result.wompiTransactionId).toMatch(/^tx-mock-/);
    expect(store.payment["pay-retry"].wompiTransactionId).toMatch(/^tx-mock-/);
    expect(store.payment["pay-retry"].reference).not.toBe("SUB_sub-retry_1");
    expect(Object.keys(store.payment)).toHaveLength(1);
  });
});

describe("Subscription Billing: Payment link creation", () => {
  beforeEach(async () => {
    const { store } = await import("../../db/prisma");
    store.customer = {};
    store.plan = {};
    store.subscription = {};
    store.payment = {};
    store.paymentLink = {};
    store.paymentAttempt = {};
    store.subscriptionBillingCycle = {};
  });

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
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    seedCycle(store, {
      id: "cycle-suspended",
      subscriptionId: "sub-suspended",
      cycleNumber: 1,
      periodStartAt: new Date("2026-04-01"),
      periodEndAt: new Date("2026-05-01"),
      dueAt: new Date("2026-04-05")
    });

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
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    seedCycle(store, {
      id: "cycle-link-2",
      subscriptionId: "sub-link",
      cycleNumber: 2,
      periodStartAt: new Date("2026-05-01"),
      periodEndAt: new Date("2026-06-01"),
      dueAt: new Date("2026-05-05")
    });

    const { createPaymentLinkForSubscription } = await import("../../services/subscriptionBilling");

    // This will try to call Wompi API which we've mocked
    const result = await createPaymentLinkForSubscription({ subscriptionId: "sub-link" });

    expect(result).toHaveProperty("paymentId");
    expect(result).toHaveProperty("wompiPaymentLinkId");
    expect(result).toHaveProperty("checkoutUrl");
  });

  it("should assign ANTICIPADO payment links to the next cycle", async () => {
    const { store } = await import("../../db/prisma");

    store.customer["cust-link-advance"] = { id: "cust-link-advance", email: "link-advance@test.com", name: "Link Advance", metadata: {} };
    store.plan = {
      ...(store.plan || {}),
      "plan-advance": { id: "plan-advance", tenantId: "tenant-1", name: "Plan", priceInCents: 15000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 }
    };
    store.subscription["sub-link-advance"] = {
      id: "sub-link-advance",
      tenantId: "tenant-1",
      customerId: "cust-link-advance",
      planId: "plan-advance",
      status: "ACTIVE",
      startAt: new Date("2026-05-19T07:24:55.034Z"),
      cycleStartDay: 1,
      paymentDay: 20,
      paymentTiming: "ANTICIPADO",
      graceDays: 3
    };
    // Los períodos se anclan a hoy: con fechas fijas, el ciclo "vigente" deja de
    // serlo cuando pasa el calendario y la prueba se cae sola meses después.
    const mesActual = startOfMonthUtc(new Date());
    const mesSiguiente = addMonthsUtc(mesActual, 1);
    const mesSubsiguiente = addMonthsUtc(mesActual, 2);

    // Ciclo 2: el período vigente (contiene hoy).
    seedCycle(store, {
      id: "cycle-link-advance-2",
      subscriptionId: "sub-link-advance",
      cycleNumber: 2,
      periodStartAt: mesActual,
      periodEndAt: mesSiguiente,
      dueAt: addDaysUtc(mesActual, -11)
    });
    // Ciclo 3: el período siguiente, que es a donde debe ir un cobro ANTICIPADO.
    seedCycle(store, {
      id: "cycle-link-advance-3",
      subscriptionId: "sub-link-advance",
      cycleNumber: 3,
      periodStartAt: mesSiguiente,
      periodEndAt: mesSubsiguiente,
      dueAt: addDaysUtc(mesSiguiente, -11)
    });

    const { createPaymentLinkForSubscription } = await import("../../services/subscriptionBilling");
    const result = await createPaymentLinkForSubscription({ subscriptionId: "sub-link-advance" });

    expect(store.payment[result.paymentId]?.cycleNumber).toBe(3);
    expect(store.payment[result.paymentId]?.subscriptionCycleKey).toBe("sub-link-advance:3");
  });

  it("should not reopen an approved payment when creating a payment link for the same cycle", async () => {
    const { store } = await import("../../db/prisma");

    store.customer["cust-approved"] = { id: "cust-approved", email: "approved@test.com", name: "Approved User", metadata: {} };
    store.plan = {
      ...(store.plan || {}),
      "plan-approved": { id: "plan-approved", tenantId: "tenant-1", name: "Plan", priceInCents: 15000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 }
    };
    store.subscription["sub-approved"] = {
      id: "sub-approved",
      tenantId: "tenant-1",
      customerId: "cust-approved",
      planId: "plan-approved",
      status: "ACTIVE",
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    store.subscriptionBillingCycle["cycle-approved"] = {
      id: "cycle-approved",
      subscriptionId: "sub-approved",
      cycleNumber: 2,
      periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
      periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
      dueAt: new Date("2026-05-05T00:00:00.000Z"),
      status: "PAID",
      paymentId: "pay-approved"
    };
    store.payment["pay-approved"] = {
      id: "pay-approved",
      tenantId: "tenant-1",
      customerId: "cust-approved",
      subscriptionId: "sub-approved",
      amountInCents: 15000,
      currency: "COP",
      cycleNumber: 2,
      reference: "SUB_sub-approved_2",
      status: "APPROVED",
      subscriptionCycleKey: "sub-approved:2",
      origin: "AUTO_LINK",
      associationReason: "SUB_REF",
      associatedBy: "system",
      paidAt: new Date("2026-05-05T12:00:00.000Z"),
      checkoutUrl: "https://checkout.wompi.co/l/existing",
      wompiPaymentLinkId: "plink-existing"
    };

    const { createPaymentLinkForSubscription } = await import("../../services/subscriptionBilling");

    await expect(
      createPaymentLinkForSubscription({ subscriptionId: "sub-approved" })
    ).rejects.toThrow("payment_already_approved");

    expect(store.payment["pay-approved"].status).toBe("APPROVED");
    expect(store.payment["pay-approved"].paidAt?.toISOString?.() || String(store.payment["pay-approved"].paidAt)).toContain("2026-05-05");
    expect(store.payment["pay-approved"].checkoutUrl).toBe("https://checkout.wompi.co/l/existing");
    expect(store.payment["pay-approved"].wompiPaymentLinkId).toBe("plink-existing");
  });
});

describe("ensureExpiredSubscriptions", () => {
  beforeEach(async () => {
    const { store } = await import("../../db/prisma");
    store.customer = {};
    store.plan = {};
    store.subscription = {};
    store.payment = {};
    store.paymentLink = {};
    store.paymentAttempt = {};
    store.subscriptionBillingCycle = {};
  });

  it("devuelve a ACTIVE una suscripción PAST_DUE cuyo ciclo ya está cobrado", async () => {
    const { prisma, store } = await import("../../db/prisma");
    store.customer["cust-recover"] = { id: "cust-recover", email: "recover@test.com", metadata: {} };
    store.plan["plan-recover"] = { id: "plan-recover", tenantId: "tenant-1", priceInCents: 15000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 };
    store.subscription["sub-recover"] = {
      id: "sub-recover",
      tenantId: "tenant-1",
      customerId: "cust-recover",
      planId: "plan-recover",
      status: "PAST_DUE",
      startAt: new Date(),
      cycleStartDay: 1,
      paymentDay: 15,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    const mes = startOfMonthUtc(new Date());
    seedCycle(store, {
      id: "cycle-recover-1",
      subscriptionId: "sub-recover",
      cycleNumber: 1,
      periodStartAt: mes,
      periodEndAt: addMonthsUtc(mes, 1),
      dueAt: addDaysUtc(mes, 14),
      status: "PAID",
      paymentId: "pay-recover"
    });

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    // Es el barrido —no el webhook— quien devuelve la suscripción a ACTIVE.
    expect(store.subscription["sub-recover"].status).toBe("ACTIVE");
  });

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
      cycleStartDay: 1,
      paymentDay: 1,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    store.subscriptionBillingCycle["cycle-pastdue"] = {
      id: "cycle-pastdue",
      subscriptionId: "sub-pastdue",
      cycleNumber: 1,
      periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
      periodEndAt: new Date("2026-04-01T00:00:00.000Z"),
      dueAt: new Date("2026-03-01T00:00:00.000Z"),
      status: "PENDING",
      paymentId: null
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    expect(store.subscription["sub-pastdue"].status).toBe("PAST_DUE");
  });

  it("should not mark ACTIVE as PAST_DUE when within grace period", async () => {
    const { prisma, store } = await import("../../db/prisma");
    const now = Date.now();
    const periodStartAt = new Date(now - 2 * 24 * 60 * 60 * 1000);
    const periodEndAt = new Date(now + 28 * 24 * 60 * 60 * 1000);
    const dueAt = new Date(now - 24 * 60 * 60 * 1000);

    // Subscription due yesterday, grace period 3 days — still within grace
    store.plan = { "plan-1": { id: "plan-1", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-grace"] = {
      id: "sub-grace",
      tenantId: "tenant-1",
      customerId: "cust-1",
      planId: "plan-1",
      startAt: periodStartAt,
      status: "ACTIVE",
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    store.subscriptionBillingCycle["cycle-grace"] = {
      id: "cycle-grace",
      subscriptionId: "sub-grace",
      cycleNumber: 1,
      periodStartAt,
      periodEndAt,
      dueAt,
      status: "PENDING",
      paymentId: null
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    // Should still be ACTIVE (within grace period)
    expect(store.subscription["sub-grace"].status).toBe("ACTIVE");
  });

  it("should mark ACTIVE as PAST_DUE when most recent cycle has paymentId but status is PENDING", async () => {
    const { store } = await import("../../db/prisma");
    const now = Date.now();
    const periodStartAt = new Date(now - 40 * 24 * 60 * 60 * 1000);
    const periodEndAt = new Date(now - 10 * 24 * 60 * 60 * 1000);
    const dueAt = new Date(now - 20 * 24 * 60 * 60 * 1000);

    store.plan = { "plan-pending": { id: "plan-pending", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-pending-payid"] = {
      id: "sub-pending-payid",
      tenantId: "tenant-1",
      customerId: "cust-1",
      planId: "plan-pending",
      startAt: periodStartAt,
      status: "ACTIVE",
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    store.subscriptionBillingCycle["cycle-pending-payid"] = {
      id: "cycle-pending-payid",
      subscriptionId: "sub-pending-payid",
      cycleNumber: 2,
      periodStartAt,
      periodEndAt,
      dueAt,
      status: "PENDING",
      paymentId: "pay-pending"
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    expect(store.subscription["sub-pending-payid"].status).toBe("PAST_DUE");
  });

  it("should keep ACTIVE when most recent cycle status is PAID even if paymentId is null", async () => {
    const { store } = await import("../../db/prisma");
    const now = Date.now();
    const periodStartAt = new Date(now - 40 * 24 * 60 * 60 * 1000);
    const periodEndAt = new Date(now - 10 * 24 * 60 * 60 * 1000);
    const dueAt = new Date(now - 20 * 24 * 60 * 60 * 1000);

    store.plan = { "plan-paid-no-id": { id: "plan-paid-no-id", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-paid-no-id"] = {
      id: "sub-paid-no-id",
      tenantId: "tenant-1",
      customerId: "cust-1",
      planId: "plan-paid-no-id",
      startAt: periodStartAt,
      status: "ACTIVE",
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    store.subscriptionBillingCycle["cycle-paid-no-id"] = {
      id: "cycle-paid-no-id",
      subscriptionId: "sub-paid-no-id",
      cycleNumber: 2,
      periodStartAt,
      periodEndAt,
      dueAt,
      status: "PAID",
      paymentId: null
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    expect(store.subscription["sub-paid-no-id"].status).toBe("ACTIVE");
  });

  it("should keep PAST_DUE subscription in PAST_DUE (suspend automation removed)", async () => {
    const { store } = await import("../../db/prisma");
    const now = Date.now();
    const dueAt = new Date(now - 25 * 24 * 60 * 60 * 1000);
    const periodStartAt = new Date(now - 55 * 24 * 60 * 60 * 1000);
    const periodEndAt = new Date(now - 25 * 24 * 60 * 60 * 1000);

    store.plan = { "plan-suspend": { id: "plan-suspend", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-suspend"] = {
      id: "sub-suspend",
      tenantId: "tenant-1",
      customerId: "cust-1",
      planId: "plan-suspend",
      startAt: periodStartAt,
      status: "PAST_DUE",
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    store.subscriptionBillingCycle["cycle-suspend"] = {
      id: "cycle-suspend",
      subscriptionId: "sub-suspend",
      cycleNumber: 2,
      periodStartAt,
      periodEndAt,
      dueAt,
      status: "PENDING",
      paymentId: null
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    // Suspend automation is disabled — PAST_DUE stays PAST_DUE regardless of days overdue
    expect(store.subscription["sub-suspend"].status).toBe("PAST_DUE");
  });

  it("should recover SUSPENDED subscription back into billing flow (cancel automation removed)", async () => {
    const { store } = await import("../../db/prisma");
    const now = Date.now();
    const dueAt = new Date(now - 60 * 24 * 60 * 60 * 1000);
    const periodStartAt = new Date(now - 90 * 24 * 60 * 60 * 1000);
    const periodEndAt = new Date(now - 60 * 24 * 60 * 60 * 1000);

    store.plan = { "plan-cancel": { id: "plan-cancel", tenantId: "tenant-1", name: "Plan", priceInCents: 10000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } };
    store.subscription["sub-cancel"] = {
      id: "sub-cancel",
      tenantId: "tenant-1",
      customerId: "cust-1",
      planId: "plan-cancel",
      startAt: periodStartAt,
      status: "SUSPENDED",
      suspendedAt: new Date(now - 31 * 24 * 60 * 60 * 1000),
      cycleStartDay: 1,
      paymentDay: 5,
      paymentTiming: "EN_CURSO",
      graceDays: 3
    };
    store.subscriptionBillingCycle["cycle-cancel"] = {
      id: "cycle-cancel",
      subscriptionId: "sub-cancel",
      cycleNumber: 2,
      periodStartAt,
      periodEndAt,
      dueAt,
      status: "PENDING",
      paymentId: null
    };

    const { ensureExpiredSubscriptions } = await import("../../services/subscriptionBilling");
    await ensureExpiredSubscriptions();

    // Cancel automation is disabled — SUSPENDED subscriptions are recovered back to PAST_DUE
    expect(store.subscription["sub-cancel"].status).toBe("PAST_DUE");
  });
});
