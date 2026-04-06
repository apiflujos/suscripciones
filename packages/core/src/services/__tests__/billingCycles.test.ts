import { describe, expect, it } from "vitest";
import { findBestBillingCycleForPayment } from "../billingCycles";

function cycle(input: {
  id: string;
  cycleNumber: number;
  start: string;
  end: string;
  due: string;
}) {
  return {
    id: input.id,
    cycleNumber: input.cycleNumber,
    periodStartAt: new Date(input.start),
    periodEndAt: new Date(input.end),
    dueAt: new Date(input.due),
    paymentId: null,
    status: "PENDING"
  };
}

describe("findBestBillingCycleForPayment", () => {
  it("elige el ciclo vencido más antiguo para pagos tardíos con varios ciclos abiertos", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-05-20T12:00:00.000Z"),
      cycles: [
        cycle({ id: "c1", cycleNumber: 1, start: "2026-03-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z", due: "2026-03-10T00:00:00.000Z" }),
        cycle({ id: "c2", cycleNumber: 2, start: "2026-04-01T00:00:00.000Z", end: "2026-05-01T00:00:00.000Z", due: "2026-04-10T00:00:00.000Z" }),
        cycle({ id: "c3", cycleNumber: 3, start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z", due: "2026-05-10T00:00:00.000Z" })
      ]
    });

    expect(result?.id).toBe("c1");
  });

  it("elige el próximo ciclo cuando el pago es anticipado", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-04-05T12:00:00.000Z"),
      cycles: [
        cycle({ id: "c2", cycleNumber: 2, start: "2026-04-01T00:00:00.000Z", end: "2026-05-01T00:00:00.000Z", due: "2026-04-10T00:00:00.000Z" }),
        cycle({ id: "c3", cycleNumber: 3, start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z", due: "2026-05-10T00:00:00.000Z" })
      ]
    });

    expect(result?.id).toBe("c2");
  });

  it("respeta el hint de ciclo si ese ciclo sigue disponible", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-05-20T12:00:00.000Z"),
      cycleNumberHint: 3,
      cycles: [
        cycle({ id: "c1", cycleNumber: 1, start: "2026-03-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z", due: "2026-03-10T00:00:00.000Z" }),
        cycle({ id: "c3", cycleNumber: 3, start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z", due: "2026-05-10T00:00:00.000Z" })
      ]
    });

    expect(result?.id).toBe("c3");
  });
});
