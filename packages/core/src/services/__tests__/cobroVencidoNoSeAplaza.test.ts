import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/prisma", () => ({ prisma: {} }));

import { ensurePaymentRetryJob } from "../retryJobScheduler";

const HOUR = 60 * 60 * 1000;

function fakeDb(runAt: Date) {
  const job = { id: "job-1", runAt, maxAttempts: 1 };
  const update = vi.fn(async ({ data }: any) => ({ ...job, ...data }));
  return { db: { retryJob: { findFirst: vi.fn(async () => job), update, create: vi.fn() } } as any, update };
}

describe("cobro vencido en cola", () => {
  const tomorrow = () => new Date(Date.now() + 24 * HOUR);

  it("la sincronización no lo pasa a mañana", async () => {
    const { db, update } = fakeDb(new Date(Date.now() - HOUR));
    await ensurePaymentRetryJob({ subscriptionId: "s", runAt: tomorrow(), keepOverdue: true, db });
    expect(update).not.toHaveBeenCalled();
  });

  it("un cobro futuro sí se puede reprogramar", async () => {
    const { db, update } = fakeDb(new Date(Date.now() + HOUR));
    await ensurePaymentRetryJob({ subscriptionId: "s", runAt: tomorrow(), keepOverdue: true, db });
    expect(update).toHaveBeenCalled();
  });

  it("tras un pago, el job vencido sí avanza al siguiente ciclo", async () => {
    const { db, update } = fakeDb(new Date(Date.now() - HOUR));
    await ensurePaymentRetryJob({ subscriptionId: "s", runAt: tomorrow(), db });
    expect(update).toHaveBeenCalled();
  });
});
