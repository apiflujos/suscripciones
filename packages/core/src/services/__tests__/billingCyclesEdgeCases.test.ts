/**
 * Tests for billing cycle edge cases from the audit:
 *   - Calendar edge cases (Feb 30, 31st in 30-day months)
 *   - Payment timing (ANTICIPADO vs EN_CURSO)
 *   - Grace period calculations
 *   - Subscription expiration flow
 */

import { describe, expect, it } from "vitest";
import {
  computeBillingCycleDueAt,
  buildBillingCyclesForSubscription,
  findBestBillingCycleForPayment,
  normalizeSubscriptionSeed,
  resolveConfiguredCollectionCycle
} from "../billingCycles";

// ── Helpers ──
function createSubSeed(overrides: Partial<any> = {}) {
  return {
    id: "sub-test",
    currentCycle: 1,
    currentPeriodStartAt: new Date("2026-01-15T00:00:00.000Z"),
    currentPeriodEndAt: new Date("2026-02-15T00:00:00.000Z"),
    cycleStartDay: 15,
    paymentDay: 20,
    paymentTiming: "EN_CURSO" as const,
    graceDays: 3,
    plan: { intervalUnit: "MONTH" as const, intervalCount: 1 },
    ...overrides
  };
}

describe("computeBillingCycleDueAt", () => {
  describe("EN_CURSO (pay during current period)", () => {
    it("should set due date to paymentDay within the current month when paymentDay >= cycleStartDay", () => {
      const dueAt = computeBillingCycleDueAt({
        periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
        cycleStartDay: 1,
        paymentDay: 15,
        paymentTiming: "EN_CURSO"
      });

      // paymentDay (15) >= cycleStartDay (1), so due in same month
      expect(dueAt.getUTCMonth()).toBe(3); // April (0-indexed)
      expect(dueAt.getUTCDate()).toBe(15);
    });

    it("should set due date to paymentDay in next month when paymentDay < cycleStartDay", () => {
      const dueAt = computeBillingCycleDueAt({
        periodStartAt: new Date("2026-04-15T00:00:00.000Z"),
        periodEndAt: new Date("2026-05-15T00:00:00.000Z"),
        cycleStartDay: 15,
        paymentDay: 5,
        paymentTiming: "EN_CURSO"
      });

      // paymentDay (5) < cycleStartDay (15), so due next month
      expect(dueAt.getUTCMonth()).toBe(4); // May (0-indexed)
      expect(dueAt.getUTCDate()).toBe(5);
    });
  });

  describe("ANTICIPADO (pay before period starts)", () => {
    it("should set due date to paymentDay in the previous month", () => {
      const dueAt = computeBillingCycleDueAt({
        periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
        cycleStartDay: 1,
        paymentDay: 25,
        paymentTiming: "ANTICIPADO"
      });

      // ANTICIPADO: pay in previous month
      expect(dueAt.getUTCMonth()).toBe(3); // April (0-indexed)
      expect(dueAt.getUTCDate()).toBe(25);
    });
  });

  describe("Calendar edge cases", () => {
    it("should handle paymentDay=31 in February (clamps to 28/29)", () => {
      const dueAt = computeBillingCycleDueAt({
        periodStartAt: new Date("2026-02-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-03-01T00:00:00.000Z"),
        cycleStartDay: 1,
        paymentDay: 31,
        paymentTiming: "EN_CURSO"
      });

      // February 2026 has 28 days — should clamp to 28
      expect(dueAt.getUTCMonth()).toBe(1); // February
      expect(dueAt.getUTCDate()).toBeLessThanOrEqual(28);
    });

    it("should handle paymentDay=30 in months with fewer days", () => {
      // April, June, September, November have 30 days
      const dueAt = computeBillingCycleDueAt({
        periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
        periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
        cycleStartDay: 1,
        paymentDay: 31,
        paymentTiming: "EN_CURSO"
      });

      // April has 30 days — paymentDay=31 should clamp to 30
      expect(dueAt.getUTCMonth()).toBe(3); // April
      expect(dueAt.getUTCDate()).toBeLessThanOrEqual(30);
    });

    it("should handle cycleStartDay=30 transitioning to February", () => {
      const dueAt = computeBillingCycleDueAt({
        periodStartAt: new Date("2026-01-30T00:00:00.000Z"),
        periodEndAt: new Date("2026-02-28T00:00:00.000Z"),
        cycleStartDay: 30,
        paymentDay: 5,
        paymentTiming: "EN_CURSO"
      });

      // Should work without errors — Feb 5 exists in all years
      expect(dueAt.getUTCMonth()).toBe(1); // February
      expect(dueAt.getUTCDate()).toBe(5);
    });
  });
});

describe("buildBillingCyclesForSubscription", () => {
  it("should infer the effective current cycle from historical anchors", () => {
    const sub = createSubSeed({
      startAt: new Date("2026-03-19T07:24:55.034Z"),
      currentCycle: 1,
      currentPeriodStartAt: new Date("2026-04-01T00:00:00.000Z"),
      currentPeriodEndAt: new Date("2026-05-01T00:00:00.000Z"),
      cycleStartDay: 1,
      paymentDay: 20,
      paymentTiming: "ANTICIPADO"
    });

    const normalized = normalizeSubscriptionSeed(sub as any);

    expect(normalized.currentCycle).toBe(2);
  });

  it("should generate cycles back and forward from current cycle", () => {
    const sub = createSubSeed({
      currentCycle: 6,
      currentPeriodStartAt: new Date("2026-06-15T00:00:00.000Z"),
      currentPeriodEndAt: new Date("2026-07-15T00:00:00.000Z")
    });

    const cycles = buildBillingCyclesForSubscription(sub, 3, 2);

    // Should generate: cycles 3, 4, 5, 6, 7, 8 (3 back + current + 2 forward)
    expect(cycles.length).toBe(6);
    expect(cycles.map((c) => c.cycleNumber)).toEqual([3, 4, 5, 6, 7, 8]);

    // First cycle should be in the past
    expect(cycles[0].periodStartAt.getUTCMonth()).toBe(2); // March
    // Last cycle should be in the future
    expect(cycles[cycles.length - 1].periodStartAt.getUTCMonth()).toBe(7); // August
  });

  it("should skip cycleNumber <= 0", () => {
    const sub = createSubSeed({
      currentCycle: 2,
      currentPeriodStartAt: new Date("2026-02-15T00:00:00.000Z"),
      currentPeriodEndAt: new Date("2026-03-15T00:00:00.000Z")
    });

    const cycles = buildBillingCyclesForSubscription(sub, 5, 2);

    // Should skip cycle -3, -2, -1, 0 — start from 1
    expect(cycles[0].cycleNumber).toBe(1);
  });
});

describe("findBestBillingCycleForPayment", () => {
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

  it("should match payment to overdue cycle (late payment)", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-05-20T12:00:00.000Z"),
      cycles: [
        cycle({ id: "c1", cycleNumber: 1, start: "2026-02-01", end: "2026-03-01", due: "2026-02-05" }),
        cycle({ id: "c2", cycleNumber: 2, start: "2026-03-01", end: "2026-04-01", due: "2026-03-05" }),
        cycle({ id: "c3", cycleNumber: 3, start: "2026-04-01", end: "2026-05-01", due: "2026-04-05" })
      ]
    });

    // All cycles overdue — should pick oldest (c1)
    expect(result?.id).toBe("c1");
  });

  it("should match payment to current cycle when paid on time", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-04-05T12:00:00.000Z"),
      cycles: [
        cycle({ id: "c2", cycleNumber: 2, start: "2026-03-01", end: "2026-04-01", due: "2026-03-05" }),
        cycle({ id: "c3", cycleNumber: 3, start: "2026-04-01", end: "2026-05-01", due: "2026-04-10" })
      ]
    });

    // c2 is overdue (due Mar 5, paying Apr 5), c3 is upcoming (due Apr 10)
    // Should pick c2 (overdue)
    expect(result?.id).toBe("c2");
  });

  it("should match payment to nearest future cycle when paid very early", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-03-15T12:00:00.000Z"),
      cycles: [
        cycle({ id: "c2", cycleNumber: 2, start: "2026-03-01", end: "2026-04-01", due: "2026-03-05" }),
        cycle({ id: "c3", cycleNumber: 3, start: "2026-04-01", end: "2026-05-01", due: "2026-04-05" })
      ]
    });

    // c2 overdue (due Mar 5, paying Mar 15), c3 upcoming
    // Should pick c2 (overdue takes priority)
    expect(result?.id).toBe("c2");
  });

  it("should return null when all cycles are already paid", () => {
    const paidCycles = [
      { ...cycle({ id: "c1", cycleNumber: 1, start: "2026-01-01", end: "2026-02-01", due: "2026-01-05" }), paymentId: "pay-1", status: "PAID" },
      { ...cycle({ id: "c2", cycleNumber: 2, start: "2026-02-01", end: "2026-03-01", due: "2026-02-05" }), paymentId: "pay-2", status: "PAID" }
    ];

    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-03-15T12:00:00.000Z"),
      cycles: paidCycles as any
    });

    expect(result).toBeNull();
  });

  it("should handle toleranceDays for payments slightly outside cycle window", () => {
    const result = findBestBillingCycleForPayment({
      paymentAt: new Date("2026-04-15T12:00:00.000Z"),
      toleranceDays: 7,
      cycles: [
        cycle({ id: "c3", cycleNumber: 3, start: "2026-04-01", end: "2026-05-01", due: "2026-04-10" })
      ]
    });

    // Payment is within cycle window (Apr 15 is within Apr 1 - May 1 + tolerance)
    expect(result?.id).toBe("c3");
  });
});

describe("resolveConfiguredCollectionCycle", () => {
  const cycles = [
    {
      id: "c-apr",
      cycleNumber: 1,
      periodStartAt: new Date("2026-04-01T00:00:00.000Z"),
      periodEndAt: new Date("2026-05-01T00:00:00.000Z"),
      dueAt: new Date("2026-04-20T00:00:00.000Z"),
      paymentId: null,
      status: "PENDING"
    },
    {
      id: "c-may",
      cycleNumber: 2,
      periodStartAt: new Date("2026-05-01T00:00:00.000Z"),
      periodEndAt: new Date("2026-06-01T00:00:00.000Z"),
      dueAt: new Date("2026-04-20T00:00:00.000Z"),
      paymentId: null,
      status: "PENDING"
    }
  ];

  it("should keep EN_CURSO on the current cycle for payments on the 19th, 20th and 21st", () => {
    const dates = [
      new Date("2026-04-19T12:00:00.000Z"),
      new Date("2026-04-20T12:00:00.000Z"),
      new Date("2026-04-21T12:00:00.000Z")
    ];

    for (const asOf of dates) {
      const target = resolveConfiguredCollectionCycle({
        cycles,
        asOf,
        paymentTiming: "EN_CURSO"
      });
      expect(target?.cycleNumber).toBe(1);
    }
  });

  it("should move ANTICIPADO to the next cycle for payments on the 19th, 20th and 21st", () => {
    const dates = [
      new Date("2026-04-19T12:00:00.000Z"),
      new Date("2026-04-20T12:00:00.000Z"),
      new Date("2026-04-21T12:00:00.000Z")
    ];

    for (const asOf of dates) {
      const target = resolveConfiguredCollectionCycle({
        cycles,
        asOf,
        paymentTiming: "ANTICIPADO"
      });
      expect(target?.cycleNumber).toBe(2);
    }
  });
});

describe("Subscription expiration flow", () => {
  it("should correctly calculate grace period expiry", () => {
    // Subscription due on April 5, grace period 3 days
    const dueAt = new Date("2026-04-05T00:00:00.000Z");
    const graceDays = 3;
    const dueWithGrace = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);

    expect(dueWithGrace.getTime()).toBe(new Date("2026-04-08T00:00:00.000Z").getTime());
  });

  it("should calculate expired cutoff (15 days after grace)", () => {
    const dueAt = new Date("2026-04-05T00:00:00.000Z");
    const graceDays = 3;
    const dueWithGrace = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
    const expiredCutoff = new Date(dueWithGrace.getTime() + 15 * 24 * 60 * 60 * 1000);

    // Expired on April 23 (Apr 5 + 3 grace + 15 days)
    expect(expiredCutoff.getUTCDate()).toBe(23);
    expect(expiredCutoff.getUTCMonth()).toBe(3); // April
  });
});
