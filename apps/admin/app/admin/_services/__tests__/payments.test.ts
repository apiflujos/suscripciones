import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  subscription: { findUnique: vi.fn() },
  subscriptionBillingCycle: { findMany: vi.fn() },
  payment: { findMany: vi.fn() }
};

vi.mock("server-only", () => ({}));
vi.mock("@suscripciones/database", () => ({ prisma }));
vi.mock("@suscripciones/core/services/wompiReconcile", () => ({
  reconcileWompiTransaction: vi.fn()
}));
vi.mock("@suscripciones/core/services/systemLog", () => ({
  systemLog: vi.fn()
}));
vi.mock("@suscripciones/core/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() }
}));
vi.mock("@suscripciones/core/services/billingCycles", () => ({
  ensureBillingCyclesForSubscription: vi.fn(() => Promise.resolve()),
  findBestBillingCycleForPayment: vi.fn(() => null),
  resolveConfiguredCollectionCycle: vi.fn(() => null),
  resolveSubscriptionBillingState: vi.fn(() => Promise.resolve(null))
}));

describe("payments admin service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps overdue unpaid billing cycles as pending instead of failed", async () => {
    // timeout bumped: dynamic import of 1400-line payments.ts is slow under WSL2 memory pressure
    const { listSubscriptionBillingCycles } = await import("../payments");

    prisma.subscription.findUnique.mockResolvedValue({
      id: "sub-1",
      startAt: new Date("2026-03-01T00:00:00Z"),
      cycleStartDay: 1,
      paymentDay: 20,
      paymentTiming: "ANTICIPADO",
      graceDays: 1,
      plan: { intervalUnit: "MONTH", intervalCount: 1 }
    });
    prisma.subscriptionBillingCycle.findMany.mockResolvedValue([
      {
        id: "cycle-1",
        subscriptionId: "sub-1",
        cycleNumber: 1,
        periodStartAt: new Date("2026-03-01T00:00:00Z"),
        periodEndAt: new Date("2026-04-01T00:00:00Z"),
        dueAt: new Date("2026-02-20T00:00:00Z"),
        status: "PENDING",
        paymentId: null,
        subscription: { id: "sub-1", plan: { id: "plan-1", name: "Plan" } },
        payment: null
      }
    ]);

    const result = await listSubscriptionBillingCycles({ subscriptionId: "sub-1", take: 12 });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.items[0]?.status).toBe("PENDING");
  }, 12000);

  it("uses subscription total with pricing metadata for auto-association suggestions", async () => {
    const { getSubscriptionAutoAssociationSuggestions } = await import("../payments");

    prisma.subscription.findUnique.mockResolvedValue({
      id: "sub-1",
      customerId: "cust-1",
      tenantId: "tenant-1",
      tenantLinks: [],
      metadata: { pricing: { totalInCents: 390000 } },
      startAt: new Date("2026-03-01T00:00:00Z"),
      cycleStartDay: 1,
      paymentDay: 20,
      paymentTiming: "ANTICIPADO",
      graceDays: 1,
      plan: {
        intervalUnit: "MONTH",
        intervalCount: 1,
        priceInCents: 360000,
        currency: "COP",
        metadata: { pricing: { totalInCents: 390000, shippingInCents: 30000 } }
      }
    });
    prisma.subscriptionBillingCycle.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);

    await getSubscriptionAutoAssociationSuggestions({ subscriptionId: "sub-1", tenantId: "tenant-1" });

    expect(prisma.payment.findMany).toHaveBeenCalled();
    const call = prisma.payment.findMany.mock.calls[0]?.[0];
    expect(call.where.amountInCents).toBe(390000);
  });
});
