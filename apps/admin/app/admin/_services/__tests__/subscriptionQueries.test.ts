import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  subscription: { findMany: vi.fn(), count: vi.fn() },
  payment: { findMany: vi.fn() },
  paymentLink: { findMany: vi.fn() },
  retryJob: { findMany: vi.fn() },
  chatwootMessage: { findMany: vi.fn() }
};

vi.mock("server-only", () => ({}));
vi.mock("@suscripciones/database", () => ({ prisma }));
vi.mock("@suscripciones/core/services/runtimeConfig", () => ({
  getAutoDebitConfig: vi.fn(async () => ({ allowManualCharge: true }))
}));
vi.mock("@suscripciones/core/services/subscriptionMode", () => ({
  resolveSubscriptionCollectionMode: vi.fn(() => "AUTO_DEBIT")
}));
vi.mock("@suscripciones/core/lib/customerMetadata", () => ({
  extractCustomerPaymentSourceId: vi.fn(() => "src_1")
}));
vi.mock("@suscripciones/core/services/billingCycles", () => ({
  buildSubscriptionBillingStateIndex: vi.fn(async ({ subscriptions }: { subscriptions: Array<{ id: string }> }) => {
    const firstId = subscriptions[0]?.id ?? "sub-1";
    return new Map([
      [
        firstId,
        {
          activeCycle: {
            cycleNumber: 2,
            periodStartAt: new Date("2026-04-01T00:00:00Z"),
            periodEndAt: new Date("2026-05-01T00:00:00Z"),
            dueAt: new Date("2026-04-20T00:00:00Z"),
            paymentId: "pay-2",
            status: "PAID"
          },
          collectionCycle: {
            cycleNumber: 2,
            periodStartAt: new Date("2026-04-01T00:00:00Z"),
            periodEndAt: new Date("2026-05-01T00:00:00Z"),
            dueAt: new Date("2026-04-20T00:00:00Z"),
            paymentId: "pay-2",
            status: "PAID"
          }
        }
      ]
    ]);
  }),
  isBillingCyclePaid: vi.fn((cycle: { status?: string } | null | undefined) => cycle?.status === "PAID"),
  resolveCollectionDelinquency: vi.fn(({ cycle, fallbackSubscriptionStatus }: { cycle?: { status?: string; dueAt?: Date } | null; fallbackSubscriptionStatus?: string }) => {
    if (cycle?.status === "PAID") return { status: "AL_DIA", dueAt: cycle.dueAt || null, dueWithGraceAt: null, daysPastDue: 0 };
    if (fallbackSubscriptionStatus === "PAST_DUE") return { status: "EN_MORA", dueAt: cycle?.dueAt || null, dueWithGraceAt: null, daysPastDue: 1 };
    return { status: "AL_DIA", dueAt: cycle?.dueAt || null, dueWithGraceAt: null, daysPastDue: 0 };
  })
}));

describe("subscriptionQueries listSubscriptions", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listSubscriptions: (args: any) => Promise<{ items: any[]; total: number }>;

  beforeAll(async () => {
    ({ listSubscriptions } = await import("../subscriptionQueries"));
  });

  beforeEach(() => {
    vi.clearAllMocks();

    prisma.subscription.findMany.mockResolvedValue([
      {
        id: "sub-1",
        tenantId: "tenant-1",
        tenantLinks: [],
        customerId: "cust-1",
        status: "ACTIVE",
        startAt: new Date("2026-03-01T00:00:00Z"),
        cycleStartDay: 1,
        paymentDay: 20,
        paymentTiming: "EN_CURSO",
        graceDays: 5,
        productId: "prod-1",
        metadata: {},
        customer: { metadata: {}, name: "Cliente", email: "cliente@test.com", phone: "3000000000" },
        product: { name: "Producto" },
        plan: {
          id: "plan-1",
          tenantId: "tenant-1",
          tenantLinks: [],
          name: "Plan 1",
          intervalUnit: "MONTH",
          intervalCount: 1,
          metadata: {},
          currency: "COP"
        }
      }
    ]);
    prisma.subscription.count.mockResolvedValue(1);
    prisma.paymentLink.findMany.mockResolvedValue([]);
    prisma.retryJob.findMany.mockResolvedValue([]);
    prisma.chatwootMessage.findMany.mockResolvedValue([]);
  });

  it("does not allow manual unmark when current paid cycle was automatic", async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        subscriptionId: "sub-1",
        cycleNumber: 2,
        createdAt: new Date("2026-04-20T10:00:00Z"),
        paidAt: new Date("2026-04-20T10:00:00Z"),
        amountInCents: 1000,
        currency: "COP",
        wompiTransactionId: "tx-1",
        reference: "SUB_sub-1_2",
        providerResponse: { manual: false }
      }
    ]);

    const result = await listSubscriptions({});

    expect(result.items[0]?.lastPaidInCurrentPeriod).toBe(true);
    expect(result.items[0]?.canManualUnmarkPaid).toBe(false);
  });

  it("allows manual unmark when current paid cycle was marked manually", async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        subscriptionId: "sub-1",
        cycleNumber: 2,
        createdAt: new Date("2026-04-20T10:00:00Z"),
        paidAt: new Date("2026-04-20T10:00:00Z"),
        amountInCents: 1000,
        currency: "COP",
        wompiTransactionId: null,
        reference: "MANUAL_sub-1_2",
        providerResponse: {}
      }
    ]);

    const result = await listSubscriptions({});

    expect(result.items[0]?.lastPaidInCurrentPeriod).toBe(true);
    expect(result.items[0]?.canManualUnmarkPaid).toBe(true);
  });

  it("uses the most recent approved payment in the cycle for manual-unmark eligibility", async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        subscriptionId: "sub-1",
        cycleNumber: 2,
        createdAt: new Date("2026-04-19T10:00:00Z"),
        paidAt: new Date("2026-04-20T10:00:00Z"),
        amountInCents: 1000,
        currency: "COP",
        wompiTransactionId: null,
        reference: "MANUAL_sub-1_2_old",
        providerResponse: {}
      },
      {
        subscriptionId: "sub-1",
        cycleNumber: 2,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        paidAt: new Date("2026-04-20T10:00:00Z"),
        amountInCents: 1000,
        currency: "COP",
        wompiTransactionId: "tx-2",
        reference: "SUB_sub-1_2_new",
        providerResponse: { manual: false }
      }
    ]);

    const result = await listSubscriptions({});

    expect(result.items[0]?.canManualUnmarkPaid).toBe(false);
  });

  it("uses paid current EN_CURSO cycle as the effective status even when persisted status is stale", async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: "sub-1",
        tenantId: "tenant-1",
        tenantLinks: [],
        customerId: "cust-1",
        status: "PAST_DUE",
        startAt: new Date("2026-03-01T00:00:00Z"),
        cycleStartDay: 1,
        paymentDay: 20,
        paymentTiming: "EN_CURSO",
        graceDays: 5,
        productId: "prod-1",
        metadata: {},
        customer: { metadata: {}, name: "Cliente", email: "cliente@test.com", phone: "3000000000" },
        product: { name: "Producto" },
        plan: {
          id: "plan-1",
          tenantId: "tenant-1",
          tenantLinks: [],
          name: "Plan 1",
          intervalUnit: "MONTH",
          intervalCount: 1,
          metadata: {},
          currency: "COP"
        }
      }
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        subscriptionId: "sub-1",
        cycleNumber: 2,
        createdAt: new Date("2026-04-20T10:00:00Z"),
        paidAt: new Date("2026-04-20T10:00:00Z"),
        amountInCents: 1000,
        currency: "COP",
        wompiTransactionId: "tx-1",
        reference: "SUB_sub-1_2",
        providerResponse: { manual: false }
      }
    ]);

    const activeResult = await listSubscriptions({ estado: "si" });
    const overdueResult = await listSubscriptions({ estado: "mora" });

    expect(activeResult.items[0]?.status).toBe("ACTIVE");
    expect(activeResult.items[0]?.persistedStatus).toBe("PAST_DUE");
    expect(activeResult.items[0]?.collectionCyclePaid).toBe(true);
    expect(overdueResult.items).toHaveLength(0);
  });

});

describe("subscriptionQueries: el aviso al cliente", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listSubscriptions: (args: any) => Promise<{ items: any[]; total: number }>;

  beforeAll(async () => {
    ({ listSubscriptions } = await import("../subscriptionQueries"));
  });

  it("expone el último aviso, traducido cuando falló", async () => {
    prisma.chatwootMessage.findMany.mockResolvedValue([
      {
        subscriptionId: "sub-1",
        type: "PAYMENT_LINK",
        status: "FAILED",
        errorMessage: "chatwoot_send_failed",
        sentAt: null,
        createdAt: new Date("2026-08-16T12:00:00Z")
      },
      {
        subscriptionId: "sub-1",
        type: "EXPIRY_WARNING",
        status: "SENT",
        errorMessage: null,
        sentAt: new Date("2026-08-10T12:00:00Z"),
        createdAt: new Date("2026-08-10T12:00:00Z")
      }
    ]);

    const res = await listSubscriptions({ take: 10 });
    const notice = res.items[0]?.lastNotice;

    expect(notice?.kind).toBe("Link de pago");
    expect(notice?.status).toBe("FAILED");
    // Nunca el código crudo.
    expect(notice?.reason).toBe("La central de comunicaciones no pudo enviar el mensaje.");
  });

  it("sin avisos la fila no inventa ninguno", async () => {
    prisma.chatwootMessage.findMany.mockResolvedValue([]);
    const res = await listSubscriptions({ take: 10 });
    expect(res.items[0]?.lastNotice).toBeNull();
  });
});
