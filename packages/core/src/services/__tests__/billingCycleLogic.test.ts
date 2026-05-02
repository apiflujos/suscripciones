import { describe, expect, it } from "vitest";
import {
  computeBillingCycleDueAt,
  isBillingCyclePaid,
  resolveConfiguredCollectionCycle
} from "../billingCycles";

function makeCycle(
  n: number,
  opts: {
    startDate: string;
    endDate: string;
    dueDate: string;
    paid?: boolean;
  }
) {
  return {
    id: `c${n}`,
    cycleNumber: n,
    periodStartAt: new Date(opts.startDate),
    periodEndAt: new Date(opts.endDate),
    dueAt: new Date(opts.dueDate),
    paymentId: opts.paid ? `pay-${n}` : null,
    status: opts.paid ? "PAID" : "PENDING"
  } as const;
}

describe("computeBillingCycleDueAt", () => {
  it("EN_CURSO: paymentDay 20 en el mismo mes del ciclo", () => {
    const result = computeBillingCycleDueAt({
      periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
      periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
      cycleStartDay: 1,
      paymentDay: 20,
      paymentTiming: "EN_CURSO"
    });

    expect(result.toISOString().slice(0, 10)).toBe("2026-05-20");
  });

  it("EN_CURSO: paymentDay 5 con cycleStartDay 15 va al mes siguiente", () => {
    const result = computeBillingCycleDueAt({
      periodStartAt: new Date("2026-05-15T00:00:00.000Z"),
      periodEndAt: new Date("2026-06-15T00:00:00.000Z"),
      cycleStartDay: 15,
      paymentDay: 5,
      paymentTiming: "EN_CURSO"
    });

    expect(result.toISOString().slice(0, 10)).toBe("2026-06-05");
  });

  it("ANTICIPADO: dueAt cae en el mes anterior al ciclo", () => {
    const result = computeBillingCycleDueAt({
      periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
      periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
      cycleStartDay: 1,
      paymentDay: 20,
      paymentTiming: "ANTICIPADO"
    });

    expect(result.toISOString().slice(0, 10)).toBe("2026-04-20");
  });

  it("paymentDay=31 en febrero se clampa al último día", () => {
    const result = computeBillingCycleDueAt({
      periodStartAt: new Date("2026-02-01T00:00:00.000Z"),
      periodEndAt: new Date("2026-03-01T00:00:00.000Z"),
      cycleStartDay: 1,
      paymentDay: 31,
      paymentTiming: "EN_CURSO"
    });

    expect(result.toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

describe("resolveConfiguredCollectionCycle", () => {
  it("EN_CURSO: ciclo vencido tiene prioridad sobre ciclo actual", () => {
    const cycles = [
      makeCycle(1, {
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-04-01T00:00:00.000Z",
        dueDate: "2026-03-20T00:00:00.000Z",
        paid: true
      }),
      makeCycle(2, {
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-05-01T00:00:00.000Z",
        dueDate: "2026-04-20T00:00:00.000Z"
      }),
      makeCycle(3, {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-06-01T00:00:00.000Z",
        dueDate: "2026-05-20T00:00:00.000Z"
      })
    ];

    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-05-01T12:00:00.000Z"),
      paymentTiming: "EN_CURSO"
    });

    expect(result?.cycleNumber).toBe(2);
  });

  it("EN_CURSO: si no hay vencidos devuelve el ciclo actual", () => {
    const cycles = [
      makeCycle(1, {
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-04-01T00:00:00.000Z",
        dueDate: "2026-03-20T00:00:00.000Z",
        paid: true
      }),
      makeCycle(2, {
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-05-01T00:00:00.000Z",
        dueDate: "2026-04-20T00:00:00.000Z",
        paid: true
      }),
      makeCycle(3, {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-06-01T00:00:00.000Z",
        dueDate: "2026-05-20T00:00:00.000Z"
      })
    ];

    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-05-01T12:00:00.000Z"),
      paymentTiming: "EN_CURSO"
    });

    expect(result?.cycleNumber).toBe(3);
  });

  it("ANTICIPADO: devuelve el ciclo futuro próximo, no el vencido", () => {
    const cycles = [
      makeCycle(1, {
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-05-01T00:00:00.000Z",
        dueDate: "2026-04-20T00:00:00.000Z"
      }),
      makeCycle(2, {
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-06-01T00:00:00.000Z",
        dueDate: "2026-04-20T00:00:00.000Z"
      }),
      makeCycle(3, {
        startDate: "2026-06-01T00:00:00.000Z",
        endDate: "2026-07-01T00:00:00.000Z",
        dueDate: "2026-05-20T00:00:00.000Z"
      })
    ];

    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-05-01T12:00:00.000Z"),
      paymentTiming: "ANTICIPADO"
    });

    expect(result?.cycleNumber).toBe(3);
  });

  it("retorna null si todos los ciclos están pagados", () => {
    const cycles = [
      makeCycle(1, {
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-04-01T00:00:00.000Z",
        dueDate: "2026-03-20T00:00:00.000Z",
        paid: true
      }),
      makeCycle(2, {
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-05-01T00:00:00.000Z",
        dueDate: "2026-04-20T00:00:00.000Z",
        paid: true
      })
    ];

    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-05-01T12:00:00.000Z"),
      paymentTiming: "EN_CURSO"
    });

    expect(result).toBeNull();
  });
});

describe("isBillingCyclePaid", () => {
  it("retorna true cuando status es PAID", () => {
    expect(isBillingCyclePaid({ status: "PAID", paymentId: "pay-1" })).toBe(true);
  });

  it("retorna false cuando status es PENDING aunque tenga paymentId", () => {
    expect(isBillingCyclePaid({ status: "PENDING", paymentId: "pay-1" })).toBe(false);
  });

  it("retorna false cuando status es PENDING y no hay paymentId", () => {
    expect(isBillingCyclePaid({ status: "PENDING", paymentId: null })).toBe(false);
  });

  it("retorna false para null", () => {
    expect(isBillingCyclePaid(null)).toBe(false);
  });

  it("retorna false para undefined", () => {
    expect(isBillingCyclePaid(undefined)).toBe(false);
  });
});
