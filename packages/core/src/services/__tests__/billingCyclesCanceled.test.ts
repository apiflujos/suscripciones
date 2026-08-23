import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/prisma", () => ({
  prisma: {
    subscriptionBillingCycle: { findMany: vi.fn(), upsert: vi.fn() },
    subscription: { findMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops)
  }
}));

vi.mock("../runtimeConfig", () => ({
  getAutoDebitConfig: vi.fn(async () => ({
    enabled: true,
    chargeAtCutoffEnabled: true,
    allowManualCharge: true,
    executionHour: "15:30",
    timeZone: "America/Bogota",
    retryEnabled: false,
    retryEveryValue: 1,
    retryEveryUnit: "DAYS" as const,
    retryEveryMinutes: 1440,
    maxRetries: 1,
    graceDays: 5
  })),
  getAppTimeZone: vi.fn(async () => "America/Bogota")
}));

import { prisma } from "../../db/prisma";
import { buildBillingSeed, ensureBillingCyclesForSubscriptions } from "../billingCycles";

const SUB = "sub-cancelada";

function semilla() {
  return buildBillingSeed({
    id: SUB,
    // Arranca hace seis meses para que el generador tenga varios ciclos que crear.
    startAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
    cycleStartDay: 1,
    paymentDay: 20,
    paymentTiming: "EN_CURSO",
    graceDays: 5,
    plan: { intervalUnit: "MONTH" as any, intervalCount: 1 }
  });
}

/** Los periodos que se habrían creado desde cero (upsert.create). */
function periodosCreados() {
  return vi
    .mocked(prisma.subscriptionBillingCycle.upsert)
    .mock.calls.map((call: any) => new Date(call[0].create.periodStartAt).getTime());
}

describe("ensureBillingCyclesForSubscriptions · suscripción cancelada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.subscriptionBillingCycle.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.subscriptionBillingCycle.upsert).mockImplementation(((args: any) => args) as any);
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([] as any);
  });

  it("no crea ciclos con periodo posterior a la cancelación", async () => {
    // Una suscripción de prueba cancelada acumuló 108 ciclos porque los webhooks
    // la seguían tocando y nadie miraba canceledAt.
    const canceladaEn = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { id: SUB, canceledAt: canceladaEn }
    ] as any);

    await ensureBillingCyclesForSubscriptions([semilla()], 12, 2);

    const creados = periodosCreados();
    expect(creados.length).toBeGreaterThan(0);
    for (const inicio of creados) {
      expect(inicio).toBeLessThan(canceladaEn.getTime());
    }
  });

  it("sigue generando ciclos futuros si la suscripción no está cancelada", async () => {
    await ensureBillingCyclesForSubscriptions([semilla()], 12, 2);

    const creados = periodosCreados();
    expect(creados.some((inicio) => inicio > Date.now())).toBe(true);
  });

  it("mantiene los ciclos que ya existían aunque sean posteriores a la cancelación", async () => {
    // Un pago tardío tiene que poder aterrizar en su ciclo: cortar la creación de
    // nuevos no puede significar dejar de actualizar los que ya están.
    const canceladaEn = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { id: SUB, canceledAt: canceladaEn }
    ] as any);

    const posterior = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.subscriptionBillingCycle.findMany).mockResolvedValue([
      {
        id: "existente",
        subscriptionId: SUB,
        cycleNumber: 6,
        periodStartAt: posterior,
        periodEndAt: new Date(posterior.getTime() + 30 * 24 * 60 * 60 * 1000),
        dueAt: posterior,
        paymentId: null,
        status: "PENDING"
      }
    ] as any);

    await ensureBillingCyclesForSubscriptions([semilla()], 12, 2);

    const tocados = vi
      .mocked(prisma.subscriptionBillingCycle.upsert)
      .mock.calls.map((call: any) => call[0].where.subscriptionId_cycleNumber.cycleNumber);
    expect(tocados).toContain(6);
  });
});
