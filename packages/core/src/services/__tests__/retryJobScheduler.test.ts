import { describe, expect, it, vi } from "vitest";
import { resolvePaymentRetryRunAt } from "../retryJobScheduler";

vi.mock("../runtimeConfig", () => ({
  getAutoDebitConfig: vi.fn(async () => ({
    executionHour: "15:00",
    timeZone: "America/Bogota"
  }))
}));

describe("resolvePaymentRetryRunAt", () => {
  it("keeps the configured due-day execution time when it is still in the future", async () => {
    const now = new Date("2026-05-20T14:00:00.000Z");
    const dueAt = new Date("2026-05-20T05:00:00.000Z");

    const runAt = await resolvePaymentRetryRunAt({ dueAt, now });

    expect(runAt.toISOString()).toBe("2026-05-20T20:00:00.000Z");
  });

  it("moves overdue retries to today at execution time when that slot is still ahead", async () => {
    const now = new Date("2026-05-20T14:00:00.000Z");
    const dueAt = new Date("2026-05-19T20:00:00.000Z");

    const runAt = await resolvePaymentRetryRunAt({ dueAt, now });

    expect(runAt.toISOString()).toBe("2026-05-20T20:00:00.000Z");
  });

  it("waits for tomorrow's execution hour when today's already passed", async () => {
    const now = new Date("2026-05-20T21:00:00.000Z");
    const dueAt = new Date("2026-05-19T20:00:00.000Z");

    const runAt = await resolvePaymentRetryRunAt({ dueAt, now });

    // Nunca "ahora": cobrar en el instante en que se crea el job es lo que
    // hacía que los cobros cayeran a cualquier hora y se repitieran.
    expect(runAt.toISOString()).toBe("2026-05-21T20:00:00.000Z");
    expect(runAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
