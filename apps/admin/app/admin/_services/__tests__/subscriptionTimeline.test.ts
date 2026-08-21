import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  subscription: { findUnique: vi.fn() },
  payment: { findMany: vi.fn() },
  chatwootMessage: { findMany: vi.fn() },
  retryJob: { findMany: vi.fn() }
};

vi.mock("server-only", () => ({}));
vi.mock("@suscripciones/database", () => ({ prisma }));
vi.mock("@suscripciones/core/services/subscriptionMode", () => ({
  resolveSubscriptionCollectionMode: vi.fn(() => "AUTO_DEBIT")
}));
vi.mock("@suscripciones/core/services/subscriptionBilling", () => ({
  readSubscriptionTotalInCents: vi.fn(() => 100_000)
}));
vi.mock("@suscripciones/core/lib/customerMetadata", () => ({
  hasActiveCustomerPaymentSource: vi.fn(() => true)
}));

const { getSubscriptionTimeline } = await import("../subscriptionTimeline");

function cycle(over: Record<string, unknown> = {}) {
  return {
    cycleNumber: 1,
    periodStartAt: new Date("2026-07-01T00:00:00Z"),
    periodEndAt: new Date("2026-08-01T00:00:00Z"),
    dueAt: new Date("2026-07-15T00:00:00Z"),
    status: "PAID",
    paidAt: new Date("2026-07-14T10:00:00Z"),
    daysLate: null,
    ...over
  };
}

beforeEach(() => {
  prisma.subscription.findUnique.mockResolvedValue({
    id: "sub-1",
    customerId: "cus-1",
    tenantId: "ten-1",
    status: "ACTIVE",
    metadata: {},
    customer: { name: "Ana Gómez", phone: "+573001112233", metadata: {} },
    plan: { name: "Plan Mensual", priceInCents: 100_000, metadata: {} },
    billingCycles: [cycle()]
  });
  prisma.payment.findMany.mockResolvedValue([]);
  prisma.chatwootMessage.findMany.mockResolvedValue([]);
  prisma.retryJob.findMany.mockResolvedValue([]);
});

describe("getSubscriptionTimeline", () => {
  it("sin id no consulta nada", async () => {
    expect(await getSubscriptionTimeline("  ")).toBeNull();
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("una suscripción inexistente devuelve null", async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    expect(await getSubscriptionTimeline("sub-x")).toBeNull();
  });

  it("separa lo cobrado de lo que falta", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: "sub-1",
      customerId: "cus-1",
      tenantId: "ten-1",
      status: "PAST_DUE",
      metadata: {},
      customer: { name: "Ana Gómez", phone: null, metadata: {} },
      plan: { name: "Plan Mensual", priceInCents: 100_000, metadata: {} },
      billingCycles: [
        cycle({ cycleNumber: 1, status: "PAID" }),
        cycle({ cycleNumber: 2, status: "PENDING", paidAt: null, dueAt: new Date("2026-08-15T00:00:00Z") }),
        cycle({ cycleNumber: 3, status: "SKIPPED", paidAt: null })
      ]
    });

    const t = (await getSubscriptionTimeline("sub-1"))!;

    expect(t.done.map((e) => e.title)).toContain("Ciclo 1 cobrado");
    expect(t.done.map((e) => e.title)).toContain("Ciclo 3 omitido");
    expect(t.pending.map((e) => e.title)).toEqual(["Ciclo 2 sin cobrar"]);
  });

  it("los ciclos se listan del más nuevo al más viejo", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: "sub-1",
      customerId: "cus-1",
      tenantId: "ten-1",
      status: "ACTIVE",
      metadata: {},
      customer: { name: "Ana", phone: null, metadata: {} },
      plan: { name: "Plan", priceInCents: 100_000, metadata: {} },
      billingCycles: [cycle({ cycleNumber: 1 }), cycle({ cycleNumber: 2 }), cycle({ cycleNumber: 3 })]
    });
    const t = (await getSubscriptionTimeline("sub-1"))!;
    expect(t.cycles.map((c) => c.cycleNumber)).toEqual([3, 2, 1]);
  });

  it("un débito automático rechazado queda como pendiente, y se dice cuál falló", async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: "p1", status: "DECLINED", origin: "AUTO_DEBIT", amountInCents: 100_000, cycleNumber: 2, paidAt: null, failedAt: new Date("2026-08-16T12:00:00Z"), createdAt: new Date("2026-08-16T11:00:00Z") },
      { id: "p2", status: "APPROVED", origin: "AUTO_DEBIT", amountInCents: 100_000, cycleNumber: 1, paidAt: new Date("2026-07-14T10:00:00Z"), failedAt: null, createdAt: new Date("2026-07-14T09:00:00Z") }
    ]);
    const t = (await getSubscriptionTimeline("sub-1"))!;
    expect(t.done.map((e) => e.title)).toContain("Pago aprobado");
    expect(t.pending.map((e) => e.title)).toContain("El débito automático fue rechazado.");
  });

  it("un pago en curso sí es un pendiente", async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: "p1", status: "PENDING", origin: "AUTO_LINK", amountInCents: 100_000, cycleNumber: 2, paidAt: null, failedAt: null, createdAt: new Date("2026-08-16T11:00:00Z") }
    ]);
    const t = (await getSubscriptionTimeline("sub-1"))!;
    expect(t.pending.map((e) => e.title)).toContain("Pago en curso");
  });

  it("un link que falló se muestra con el motivo traducido", async () => {
    prisma.chatwootMessage.findMany.mockResolvedValue([
      { id: "m1", type: "PAYMENT_LINK", status: "FAILED", errorMessage: "chatwoot_send_failed", content: "hola", sentAt: null, createdAt: new Date("2026-08-16T12:00:00Z") },
      { id: "m2", type: "EXPIRY_WARNING", status: "SENT", errorMessage: null, content: "recordatorio", sentAt: new Date("2026-08-10T12:00:00Z"), createdAt: new Date("2026-08-10T12:00:00Z") }
    ]);
    const t = (await getSubscriptionTimeline("sub-1"))!;
    const fallo = t.pending.find((e) => e.title === "Link de pago falló");
    expect(fallo?.detail).toBe("La central de comunicaciones no pudo enviar el mensaje.");
    expect(t.done.map((e) => e.title)).toContain("Aviso de vencimiento entregado");
  });

  it("un aviso todavía en cola no se cuenta como fallo", async () => {
    prisma.chatwootMessage.findMany.mockResolvedValue([
      { id: "m1", type: "PAYMENT_LINK", status: "PENDING", errorMessage: null, content: "hola", sentAt: null, createdAt: new Date("2026-08-16T12:00:00Z") }
    ]);
    const t = (await getSubscriptionTimeline("sub-1"))!;
    expect(t.pending.map((e) => e.title)).toContain("Link de pago en cola");
  });

  it("incluye los avisos del cliente sin suscripción, como la tokenización", async () => {
    await getSubscriptionTimeline("sub-1");
    const where = prisma.chatwootMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { subscriptionId: "sub-1" },
      { subscriptionId: null, customerId: "cus-1" }
    ]);
  });

  it("el débito automático sin tarjeta es un pendiente explícito", async () => {
    const mod = await import("@suscripciones/core/lib/customerMetadata");
    vi.mocked(mod.hasActiveCustomerPaymentSource).mockReturnValueOnce(false);
    const t = (await getSubscriptionTimeline("sub-1"))!;
    expect(t.pending.map((e) => e.title)).toContain("Sin tarjeta registrada");
  });

  it("lo agendado sale del próximo al último y traduce el job", async () => {
    prisma.retryJob.findMany.mockResolvedValue([
      { id: "j1", type: "SUBSCRIPTION_REMINDER", status: "PENDING", runAt: new Date("2026-08-21T14:00:00Z"), attempts: 0, maxAttempts: 5, payload: { subscriptionId: "sub-1", trigger: "SUBSCRIPTION_DUE" }, lastError: null },
      { id: "j2", type: "PAYMENT_RETRY", status: "RUNNING", runAt: new Date("2026-08-22T14:00:00Z"), attempts: 2, maxAttempts: 5, payload: { subscriptionId: "sub-1" }, lastError: null }
    ]);
    const t = (await getSubscriptionTimeline("sub-1"))!;
    expect(t.scheduled.map((e) => e.title)).toEqual(["Aviso de vencimiento o mora", "Cobro / reintento de cobro"]);
    expect(t.scheduled[0].detail).toContain("vencimiento de suscripción");
    expect(t.scheduled[1].detail).toContain("ejecutándose ahora");
    expect(t.scheduled[1].detail).toContain("intento 2 de 5");
  });

  it("solo pide los jobs de esta suscripción", async () => {
    await getSubscriptionTimeline("sub-1");
    expect(prisma.retryJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payload: { path: ["subscriptionId"], equals: "sub-1" }
        })
      })
    );
  });

  it("avisa cuando hay más trabajos de los que caben", async () => {
    prisma.retryJob.findMany.mockResolvedValue(
      Array.from({ length: 26 }, (_, i) => ({
        id: `j${i}`,
        type: "PAYMENT_RETRY",
        status: "PENDING",
        runAt: new Date("2026-08-21T14:00:00Z"),
        attempts: 0,
        maxAttempts: 5,
        payload: { subscriptionId: "sub-1" },
        lastError: null
      }))
    );
    const t = (await getSubscriptionTimeline("sub-1"))!;
    expect(t.truncated).toBe(true);
    expect(t.scheduled).toHaveLength(25);
  });
});
