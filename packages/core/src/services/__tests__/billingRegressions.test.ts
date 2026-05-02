import { describe, expect, it } from "vitest";
import {
  isBillingCyclePaid,
  resolveConfiguredCollectionCycle
} from "../billingCycles";

describe("Regression: bugs de producción corregidos", () => {
  it("REG-001: cycle vencido en límite de período no queda invisible", () => {
    const cycles = [
      {
        id: "apr",
        cycleNumber: 1,
        periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
        dueAt: new Date("2026-04-20T00:00:00.000Z"),
        paymentId: null,
        status: "PENDING"
      },
      {
        id: "may",
        cycleNumber: 2,
        periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
        dueAt: new Date("2026-05-20T00:00:00.000Z"),
        paymentId: null,
        status: "PENDING"
      }
    ];

    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-05-01T12:00:00.000Z"),
      paymentTiming: "EN_CURSO"
    });

    expect(result?.id).toBe("apr");
  });

  it("REG-002: paymentId sin status PAID no cuenta como pagado", () => {
    const cyclePendingWithPayment = {
      status: "PENDING",
      paymentId: "payment-123"
    };

    expect(isBillingCyclePaid(cyclePendingWithPayment)).toBe(false);
  });

  it("REG-003: ciclo PAID sin paymentId explícito sigue siendo pagado", () => {
    const cycleStatusPaidNoId = {
      status: "PAID",
      paymentId: null
    };

    expect(isBillingCyclePaid(cycleStatusPaidNoId)).toBe(true);
  });
});
