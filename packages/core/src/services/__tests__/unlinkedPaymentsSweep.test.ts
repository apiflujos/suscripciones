import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionFindMany = vi.fn();
const paymentFindMany = vi.fn();
const associate = vi.fn();
const reconcile = vi.fn();

vi.mock("../../db/prisma", () => ({
  prisma: { subscription: { findMany: (...a: any[]) => subscriptionFindMany(...a) }, payment: { findMany: (...a: any[]) => paymentFindMany(...a) } }
}));
vi.mock("../paymentAssociation", () => ({ associatePaymentToSubscription: (...a: any[]) => associate(...a) }));
vi.mock("../billingCycles", () => ({ reconcileApprovedPaymentWithSubscription: (...a: any[]) => reconcile(...a) }));
vi.mock("../systemLog", () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { sweepUnlinkedPayments, SWEEP_ACTOR } from "../unlinkedPaymentsSweep";

const sub = (id: string, name: string, priceInCents: number, extra: Record<string, any> = {}) => ({
  id,
  customerId: `c-${id}`,
  metadata: null,
  customer: { name, email: extra.email ?? null, phone: extra.phone ?? null },
  plan: { priceInCents, currency: "COP", metadata: null }
});
const payment = (id: string, name: string, amountInCents: number, paidAt: string, extra: Record<string, any> = {}) => ({
  id,
  amountInCents,
  currency: "COP",
  paidAt: new Date(paidAt),
  createdAt: new Date(paidAt),
  customer: { id: `dup-${id}`, name, email: extra.email ?? null, phone: extra.phone ?? null }
});

describe("sweepUnlinkedPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    associate.mockResolvedValue({ ok: true });
    reconcile.mockResolvedValue({});
  });

  it("asocia el pago de un contacto con nombre parecido y monto exacto, del más viejo al más nuevo", async () => {
    subscriptionFindMany.mockResolvedValue([sub("s1", "Lina Marcela Cruz", 62000000)]);
    paymentFindMany.mockResolvedValue([
      payment("p1", "Lina Cruz", 62000000, "2026-09-01T15:00:00Z"),
      payment("p2", "Lina Cruz", 62000000, "2026-10-26T15:00:00Z")
    ]);
    const res = await sweepUnlinkedPayments();
    expect(res).toMatchObject({ scanned: 2, associated: 2, subscriptionsUpdated: 1 });
    expect(associate.mock.calls.map((c) => c[0].paymentId)).toEqual(["p1", "p2"]);
    expect(associate.mock.calls[0][0]).toMatchObject({ subscriptionId: "s1", actorEmail: SWEEP_ACTOR });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0]).toMatchObject({ subscriptionId: "s1", paymentId: "p2" });
  });

  it("no asocia si el monto no es exactamente el cobro", async () => {
    subscriptionFindMany.mockResolvedValue([sub("s1", "Lina Marcela Cruz", 62000000)]);
    paymentFindMany.mockResolvedValue([payment("p1", "Lina Cruz", 31999000, "2026-09-01T15:00:00Z")]);
    const res = await sweepUnlinkedPayments();
    expect(res).toMatchObject({ associated: 0, noMatch: 1 });
    expect(associate).not.toHaveBeenCalled();
  });

  it("no mezcla homónimos de una sola palabra", async () => {
    subscriptionFindMany.mockResolvedValue([sub("s1", "Juan Lozano", 46000000)]);
    paymentFindMany.mockResolvedValue([payment("p1", "Juan Gonzalez", 46000000, "2026-09-01T15:00:00Z")]);
    expect((await sweepUnlinkedPayments()).noMatch).toBe(1);
    expect(associate).not.toHaveBeenCalled();
  });

  it("con dos suscripciones posibles no adivina", async () => {
    subscriptionFindMany.mockResolvedValue([sub("s1", "Carlos Manuel Uribe", 46000000), sub("s2", "Carlos Manuel Uribe Lalinde", 46000000)]);
    paymentFindMany.mockResolvedValue([payment("p1", "Carlos Manuel Uribe", 46000000, "2026-08-24T15:00:00Z")]);
    const res = await sweepUnlinkedPayments();
    expect(res).toMatchObject({ associated: 0, ambiguous: 1 });
    expect(associate).not.toHaveBeenCalled();
  });

  it("cuenta aparte lo que no encaja en ningún ciclo y no refresca la suscripción", async () => {
    subscriptionFindMany.mockResolvedValue([sub("s1", "Tomás Pineda", 46000000)]);
    paymentFindMany.mockResolvedValue([payment("p1", "Tomas Pineda", 46000000, "2026-05-05T15:00:00Z")]);
    associate.mockResolvedValue({ ok: false, error: "out_of_cycle" });
    const res = await sweepUnlinkedPayments();
    expect(res).toMatchObject({ associated: 0, outOfCycle: 1, subscriptionsUpdated: 0 });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("en simulación no escribe nada", async () => {
    subscriptionFindMany.mockResolvedValue([sub("s1", "Lina Marcela Cruz", 62000000)]);
    paymentFindMany.mockResolvedValue([payment("p1", "Lina Cruz", 62000000, "2026-09-01T15:00:00Z")]);
    const res = await sweepUnlinkedPayments({ dryRun: true });
    expect(res.associated).toBe(1);
    expect(associate).not.toHaveBeenCalled();
  });
});
