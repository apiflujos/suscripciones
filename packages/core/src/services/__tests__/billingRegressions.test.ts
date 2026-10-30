import { describe, expect, it } from "vitest";
import {
  findBestBillingCycleForPayment,
  isBillingCyclePaid,
  resolveConfiguredCollectionCycle
} from "../billingCycles";

describe("Regression: bugs de producción corregidos", () => {
  it("REG-001: el ciclo vigente manda mientras su dueAt no haya vencido", () => {
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

    expect(result?.id).toBe("may");
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

  it("REG-004: un arrastre con paymentId pendiente no desplaza al ciclo vigente", () => {
    const cycles = [
      {
        id: "apr",
        cycleNumber: 1,
        periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
        dueAt: new Date("2026-04-20T00:00:00.000Z"),
        paymentId: "pay-pending",
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

    expect(result?.id).toBe("may");
  });

  it("REG-004B: un ciclo SKIPPED viejo no desplaza al ciclo vigente ni marca mora falsa", () => {
    const cycles = [
      {
        id: "apr-skipped",
        cycleNumber: 1,
        periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
        dueAt: new Date("2026-04-20T00:00:00.000Z"),
        paymentId: null,
        status: "SKIPPED"
      },
      {
        id: "may",
        cycleNumber: 2,
        periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
        dueAt: new Date("2026-05-20T20:00:00.000Z"),
        paymentId: null,
        status: "PENDING"
      }
    ];

    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-05-20T14:56:31.000Z"),
      paymentTiming: "EN_CURSO"
    });

    expect(result?.id).toBe("may");
  });

  it("REG-005: la conciliación prioriza el ciclo cuyo período contiene el pago", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-05-20T12:00:00.000Z"),
      cycles: [
        {
          id: "apr",
          cycleNumber: 1,
          periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
          periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
          dueAt: new Date("2026-04-20T00:00:00.000Z"),
          paymentId: "pay-pending",
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
      ]
    });

    expect(result?.id).toBe("may");
  });
});

describe("Regression: EN_CURSO no adelanta el cobro al período siguiente", () => {
  const cycle = (n: number, start: string, end: string, due: string, status = "PENDING") => ({
    id: `c${n}`,
    cycleNumber: n,
    periodStartAt: new Date(start),
    periodEndAt: new Date(end),
    dueAt: new Date(due),
    paymentId: status === "PAID" ? `p${n}` : null,
    status
  });

  it("con el período vigente pagado, el ciclo futuro no es cobrable (30 sep con septiembre pago)", () => {
    const cycles = [
      cycle(8, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "2026-09-20T20:30:00Z", "PAID"),
      cycle(9, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "2026-10-20T20:30:00Z"),
      cycle(10, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", "2026-11-20T20:30:00Z")
    ];
    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-09-30T13:39:00Z"),
      paymentTiming: "EN_CURSO"
    });
    expect(result).toBeNull();
  });

  it("recibe solo los ciclos abiertos (como el cobro manual) y tampoco adelanta", () => {
    const abiertos = [
      cycle(9, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "2026-10-20T20:30:00Z"),
      cycle(10, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", "2026-11-20T20:30:00Z")
    ];
    const result = resolveConfiguredCollectionCycle({
      cycles: abiertos,
      asOf: new Date("2026-09-30T13:39:00Z"),
      paymentTiming: "EN_CURSO"
    });
    expect(result).toBeNull();
  });

  it("un arrastre vencido sigue siendo cobrable aunque el período vigente esté pago", () => {
    const cycles = [
      cycle(7, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z", "2026-08-20T20:30:00Z"),
      cycle(8, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "2026-09-20T20:30:00Z", "PAID"),
      cycle(9, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "2026-10-20T20:30:00Z")
    ];
    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-09-30T13:39:00Z"),
      paymentTiming: "EN_CURSO"
    });
    expect(result?.cycleNumber).toBe(7);
  });

  it("el primer ciclo de una suscripción que aún no arranca sí se puede cobrar", () => {
    const cycles = [cycle(1, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", "2026-11-20T20:30:00Z")];
    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-10-30T00:00:00Z"),
      paymentTiming: "EN_CURSO"
    });
    expect(result?.cycleNumber).toBe(1);
  });

  it("ANTICIPADO sigue cobrando el próximo ciclo futuro", () => {
    const cycles = [
      cycle(8, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "2026-08-20T20:30:00Z", "PAID"),
      cycle(9, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "2026-09-20T20:30:00Z")
    ];
    const result = resolveConfiguredCollectionCycle({
      cycles,
      asOf: new Date("2026-09-30T13:39:00Z"),
      paymentTiming: "ANTICIPADO"
    });
    expect(result?.cycleNumber).toBe(9);
  });
});
