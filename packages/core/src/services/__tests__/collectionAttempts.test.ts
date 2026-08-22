import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  payment: { findMany: vi.fn(), findFirst: vi.fn() },
  paymentAttempt: { count: vi.fn(), findFirst: vi.fn() }
};

vi.mock("../../db/prisma", () => ({ prisma }));

const { countCycleChargeAttempts, hasExhaustedCycleAttempts, hasRecentChargeAttempt, maxAttemptsPerCycle } = await import("../collectionAttempts");

beforeEach(() => {
  prisma.payment.findMany.mockResolvedValue([]);
  prisma.payment.findFirst.mockResolvedValue(null);
  prisma.paymentAttempt.count.mockResolvedValue(0);
  prisma.paymentAttempt.findFirst.mockResolvedValue(null);
});

describe("maxAttemptsPerCycle", () => {
  it("sin reintentos, un solo cobro por ciclo", () => {
    expect(maxAttemptsPerCycle({ retryEnabled: false, maxRetries: 5 })).toBe(1);
  });

  it("con reintentos, el cobro original más los permitidos", () => {
    expect(maxAttemptsPerCycle({ retryEnabled: true, maxRetries: 1 })).toBe(2);
    expect(maxAttemptsPerCycle({ retryEnabled: true, maxRetries: 0 })).toBe(1);
  });
});

describe("countCycleChargeAttempts", () => {
  it("sin ciclo o sin id no consulta nada", async () => {
    expect(await countCycleChargeAttempts({ subscriptionId: "", cycleNumber: 3 })).toBe(0);
    expect(await countCycleChargeAttempts({ subscriptionId: "sub-1", cycleNumber: null })).toBe(0);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it("cuenta los intentos aunque compartan una sola fila de pago", async () => {
    prisma.payment.findMany.mockResolvedValue([{ id: "pay-1" }]);
    prisma.paymentAttempt.count.mockResolvedValue(46);
    expect(await countCycleChargeAttempts({ subscriptionId: "sub-1", cycleNumber: 5 })).toBe(46);
  });

  it("cuenta los pagos cuando no hay intentos registrados", async () => {
    prisma.payment.findMany.mockResolvedValue([{ id: "pay-1" }, { id: "pay-2" }]);
    prisma.paymentAttempt.count.mockResolvedValue(0);
    expect(await countCycleChargeAttempts({ subscriptionId: "sub-1", cycleNumber: 5 })).toBe(2);
  });
});

describe("hasExhaustedCycleAttempts", () => {
  it("un ciclo sin cobros todavía puede cobrarse", async () => {
    const r = await hasExhaustedCycleAttempts({
      subscriptionId: "sub-1",
      cycleNumber: 5,
      config: { retryEnabled: true, maxRetries: 1 }
    });
    expect(r).toMatchObject({ exhausted: false, attempts: 0, allowed: 2 });
  });

  it("con un cobro hecho y un reintento permitido, todavía queda uno", async () => {
    prisma.payment.findMany.mockResolvedValue([{ id: "pay-1" }]);
    prisma.paymentAttempt.count.mockResolvedValue(1);
    const r = await hasExhaustedCycleAttempts({
      subscriptionId: "sub-1",
      cycleNumber: 5,
      config: { retryEnabled: true, maxRetries: 1 }
    });
    expect(r.exhausted).toBe(false);
  });

  it("con el original y su reintento, no se vuelve a pasar la tarjeta", async () => {
    prisma.payment.findMany.mockResolvedValue([{ id: "pay-1" }]);
    prisma.paymentAttempt.count.mockResolvedValue(2);
    const r = await hasExhaustedCycleAttempts({
      subscriptionId: "sub-1",
      cycleNumber: 5,
      config: { retryEnabled: true, maxRetries: 1 }
    });
    expect(r).toMatchObject({ exhausted: true, attempts: 2, allowed: 2 });
  });

  it("46 intentos con reintentos apagados está agotadísimo", async () => {
    prisma.payment.findMany.mockResolvedValue([{ id: "pay-1" }]);
    prisma.paymentAttempt.count.mockResolvedValue(46);
    const r = await hasExhaustedCycleAttempts({
      subscriptionId: "sub-1",
      cycleNumber: 5,
      config: { retryEnabled: false, maxRetries: 0 }
    });
    expect(r.exhausted).toBe(true);
  });
});

describe("hasRecentChargeAttempt", () => {
  it("sin id no consulta nada", async () => {
    const r = await hasRecentChargeAttempt({ subscriptionId: "" });
    expect(r.recent).toBe(false);
  });

  it("un intento reciente frena el segundo cobro", async () => {
    const at = new Date();
    prisma.paymentAttempt.findFirst.mockResolvedValue({ createdAt: at });
    const r = await hasRecentChargeAttempt({ subscriptionId: "sub-1" });
    expect(r).toEqual({ recent: true, at });
  });

  it("sin intentos mira también los pagos, por si no quedó fila de intento", async () => {
    const at = new Date();
    prisma.paymentAttempt.findFirst.mockResolvedValue(null);
    prisma.payment.findFirst.mockResolvedValue({ createdAt: at });
    const r = await hasRecentChargeAttempt({ subscriptionId: "sub-1" });
    expect(r).toEqual({ recent: true, at });
  });

  it("sin nada reciente, deja cobrar", async () => {
    prisma.paymentAttempt.findFirst.mockResolvedValue(null);
    prisma.payment.findFirst.mockResolvedValue(null);
    const r = await hasRecentChargeAttempt({ subscriptionId: "sub-1" });
    expect(r).toEqual({ recent: false, at: null });
  });

  it("con ventana en cero no bloquea nada", async () => {
    const r = await hasRecentChargeAttempt({ subscriptionId: "sub-1", withinMs: 0 });
    expect(r.recent).toBe(false);
  });
});
