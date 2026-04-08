import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@suscripciones/database", () => ({ prisma: {} }));
vi.mock("@suscripciones/core/services/wompiReconcile", () => ({
  reconcileWompiTransaction: vi.fn()
}));
vi.mock("@suscripciones/core/services/systemLog", () => ({
  systemLog: vi.fn()
}));
vi.mock("@suscripciones/core/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
}));
vi.mock("@suscripciones/core/services/billingCycles", async () => {
  const actual = await vi.importActual<any>("@suscripciones/core/services/billingCycles");
  return {
    ...actual,
    ensureBillingCyclesForSubscription: vi.fn()
  };
});

import { buildUniquePaymentCycleSuggestions } from "../payments";

describe("buildUniquePaymentCycleSuggestions", () => {
  it("sugiere cada pago una sola vez aunque existan varios ciclos abiertos", () => {
    const suggestions = buildUniquePaymentCycleSuggestions({
      subscriptionId: "sub_1",
      paymentTiming: "EN_CURSO",
      cycles: [
        {
          id: "c1",
          cycleNumber: 1,
          periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
          dueAt: new Date("2026-04-20T00:00:00.000Z"),
          status: "PENDING"
        },
        {
          id: "c2",
          cycleNumber: 2,
          periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
          dueAt: new Date("2026-05-20T00:00:00.000Z"),
          status: "PENDING"
        }
      ],
      payments: [
        {
          id: "p1",
          amountInCents: 10000,
          currency: "COP",
          status: "APPROVED",
          paidAt: new Date("2026-04-20T12:00:00.000Z"),
          createdAt: new Date("2026-04-20T12:00:00.000Z"),
          reference: "SUB_sub_1_1",
          wompiTransactionId: "tx_1",
          origin: "WEBHOOK",
          cycleNumber: null
        }
      ]
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.payment.id).toBe("p1");
    expect(suggestions[0]?.suggestedCycle?.id).toBe("c1");
    expect(suggestions[0]?.alternativeCycles.map((cycle) => cycle.id)).toEqual(["c1", "c2"]);
  });

  it("reserva ciclos únicos para pagos múltiples ordenados por fecha", () => {
    const suggestions = buildUniquePaymentCycleSuggestions({
      subscriptionId: "sub_1",
      paymentTiming: "EN_CURSO",
      cycles: [
        {
          id: "c1",
          cycleNumber: 1,
          periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
          dueAt: new Date("2026-04-20T00:00:00.000Z"),
          status: "PENDING"
        },
        {
          id: "c2",
          cycleNumber: 2,
          periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
          dueAt: new Date("2026-05-20T00:00:00.000Z"),
          status: "PENDING"
        }
      ],
      payments: [
        {
          id: "p2",
          amountInCents: 10000,
          currency: "COP",
          status: "APPROVED",
          paidAt: new Date("2026-05-20T12:00:00.000Z"),
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          reference: "SUB_sub_1_2",
          wompiTransactionId: "tx_2",
          origin: "WEBHOOK",
          cycleNumber: null
        },
        {
          id: "p1",
          amountInCents: 10000,
          currency: "COP",
          status: "APPROVED",
          paidAt: new Date("2026-04-20T12:00:00.000Z"),
          createdAt: new Date("2026-04-20T12:00:00.000Z"),
          reference: "SUB_sub_1_1",
          wompiTransactionId: "tx_1",
          origin: "WEBHOOK",
          cycleNumber: null
        }
      ]
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((entry) => entry.payment.id)).toEqual(["p1", "p2"]);
    expect(suggestions.map((entry) => entry.suggestedCycle?.id)).toEqual(["c1", "c2"]);
  });

  it("para pago adelantado propone el siguiente ciclo", () => {
    const suggestions = buildUniquePaymentCycleSuggestions({
      subscriptionId: "sub_1",
      paymentTiming: "ANTICIPADO",
      cycles: [
        {
          id: "c1",
          cycleNumber: 1,
          periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
          dueAt: new Date("2026-03-20T00:00:00.000Z"),
          status: "PENDING"
        },
        {
          id: "c2",
          cycleNumber: 2,
          periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
          dueAt: new Date("2026-04-20T00:00:00.000Z"),
          status: "PENDING"
        }
      ],
      payments: [
        {
          id: "p1",
          amountInCents: 10000,
          currency: "COP",
          status: "APPROVED",
          paidAt: new Date("2026-04-20T12:00:00.000Z"),
          createdAt: new Date("2026-04-20T12:00:00.000Z"),
          reference: "SUB_sub_1_2",
          wompiTransactionId: "tx_1",
          origin: "WEBHOOK",
          cycleNumber: null
        }
      ]
    });

    expect(suggestions[0]?.suggestedCycle?.id).toBe("c2");
    expect(suggestions[0]?.reasonCode).toBe("REFERENCE_MATCH");
  });
});
