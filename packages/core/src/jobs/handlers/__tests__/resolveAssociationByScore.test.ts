import { describe, it, expect, vi } from "vitest";

// El handler importa prisma transitivamente; no lo usamos (las pruebas pasan un
// `db` falso). Lo mockeamos para poder cargar el módulo en vitest.
vi.mock("@suscripciones/database", () => ({ prisma: {} }));

import { resolveAssociationByScore } from "../processWompiEvent";
import { classifyReference } from "../../../webhooks/wompi/classifyReference";

/**
 * Regresión del bug de "pagos huérfanos": cuando el webhook de Wompi crea un
 * Customer DUPLICADO (mismo cliente, otra fila, con otro email y sin la
 * suscripción), el pago no se asociaba porque el match por nombre solo corría
 * si email/teléfono no encontraban NADA. Ahora el match por nombre siempre
 * corre y une candidatos, y la asociación sigue exigiendo monto exacto.
 */

type Customer = { id: string; email: string | null; phone: string | null; name: string; tenantId: string };
type Sub = {
  id: string;
  customerId: string;
  tenantId: string;
  status: string;
  metadata: unknown;
  startAt: Date;
  cycleStartDay: number;
  paymentDay: number;
  graceDays: number;
  paymentTiming: string;
  plan: { priceInCents: number; currency: string; metadata: unknown; intervalUnit: string; intervalCount: number };
};

function makeDb(customers: Customer[], subscriptions: Sub[]) {
  return {
    customer: {
      findMany: async ({ where }: any) => {
        if (where?.email) {
          return customers.filter((c) => c.email === where.email).map((c) => ({ id: c.id }));
        }
        if (where?.phone) {
          return customers.filter((c) => c.phone).map((c) => ({ id: c.id, phone: c.phone }));
        }
        // Query por nombre: trae el lote del tenant (el filtro por nombre
        // normalizado ocurre en JS dentro de resolveAssociationByScore).
        return customers.map((c) => ({ id: c.id, name: c.name }));
      }
    },
    subscription: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.customerId?.in || [];
        return subscriptions.filter((s) => ids.includes(s.customerId));
      },
      findUnique: async () => null
    },
    subscriptionBillingCycle: {
      findMany: async () => []
    }
  } as any;
}

const baseSub = (over: Partial<Sub>): Sub => ({
  id: "sub-1",
  customerId: "cust-real",
  tenantId: "t1",
  status: "ACTIVE",
  metadata: {},
  startAt: new Date("2026-01-01T00:00:00.000Z"),
  cycleStartDay: 1,
  paymentDay: 20,
  graceDays: 1,
  paymentTiming: "EN_CURSO",
  plan: { priceInCents: 46000000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 },
  ...over
});

const commonArgs = {
  tenantId: "t1",
  currency: "COP",
  matchReason: null,
  paymentMatched: null,
  paymentLinkRecord: null,
  referenceClassification: classifyReference("gJjL7d_1781041053_OWs9kh2nG")
};

describe("resolveAssociationByScore — pagos de clientes duplicados", () => {
  it("asocia el pago aunque el email caiga en un Customer duplicado sin suscripción (match por nombre)", async () => {
    const customers: Customer[] = [
      { id: "cust-real", email: "real@x.com", phone: "3001112222", name: "Tomas Pineda", tenantId: "t1" },
      { id: "cust-dup", email: "link@x.com", phone: null, name: "Tomas Pineda", tenantId: "t1" }
    ];
    const subs = [baseSub({ id: "sub-1", customerId: "cust-real" })];
    const db = makeDb(customers, subs);

    const decision = await resolveAssociationByScore({
      ...commonArgs,
      db,
      amountInCents: 46000000,
      email: "link@x.com", // email del duplicado
      phone: null,
      name: "Tomas Pineda"
    });

    expect(decision?.subscriptionId).toBe("sub-1");
  });

  it("normaliza tildes: 'Tomás Pineda' (sub) vs 'Tomas Pineda' (pago)", async () => {
    const customers: Customer[] = [
      { id: "cust-real", email: "real@x.com", phone: null, name: "Tomás Pineda", tenantId: "t1" },
      { id: "cust-dup", email: "link@x.com", phone: null, name: "Tomas Pineda", tenantId: "t1" }
    ];
    const subs = [baseSub({ id: "sub-1", customerId: "cust-real" })];
    const db = makeDb(customers, subs);

    const decision = await resolveAssociationByScore({
      ...commonArgs,
      db,
      amountInCents: 46000000,
      email: "link@x.com",
      phone: null,
      name: "Tomas Pineda"
    });

    expect(decision?.subscriptionId).toBe("sub-1");
  });

  it("sigue funcionando el match directo por email del cliente real", async () => {
    const customers: Customer[] = [
      { id: "cust-real", email: "real@x.com", phone: null, name: "Tomas Pineda", tenantId: "t1" }
    ];
    const subs = [baseSub({ id: "sub-1", customerId: "cust-real" })];
    const db = makeDb(customers, subs);

    const decision = await resolveAssociationByScore({
      ...commonArgs,
      db,
      amountInCents: 46000000,
      email: "real@x.com",
      phone: null,
      name: "Tomas Pineda"
    });

    expect(decision?.subscriptionId).toBe("sub-1");
  });

  it("NO asocia una compra suelta cuyo monto no cuadra ni por identidad exacta ni Tier-2 con varias subs", async () => {
    // Cliente con DOS subs activas y el pago no cuadra con ninguna exacta -> ambiguo -> null
    const customers: Customer[] = [
      { id: "cust-real", email: "real@x.com", phone: null, name: "Alejandro Celis", tenantId: "t1" }
    ];
    const subs = [
      baseSub({ id: "sub-a", customerId: "cust-real", plan: { priceInCents: 39000000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } }),
      baseSub({ id: "sub-b", customerId: "cust-real", plan: { priceInCents: 62000000, currency: "COP", metadata: {}, intervalUnit: "MONTH", intervalCount: 1 } })
    ];
    const db = makeDb(customers, subs);

    const decision = await resolveAssociationByScore({
      ...commonArgs,
      db,
      amountInCents: 198109300, // compra grande, no cuadra con 390k ni 620k
      email: "real@x.com",
      phone: null,
      name: "Alejandro Celis"
    });

    expect(decision).toBeNull();
  });

  it("devuelve null cuando ni email, ni teléfono, ni nombre coinciden", async () => {
    const customers: Customer[] = [
      { id: "cust-real", email: "real@x.com", phone: null, name: "Tomas Pineda", tenantId: "t1" }
    ];
    const subs = [baseSub({ id: "sub-1", customerId: "cust-real" })];
    const db = makeDb(customers, subs);

    const decision = await resolveAssociationByScore({
      ...commonArgs,
      db,
      amountInCents: 46000000,
      email: "otro@x.com",
      phone: null,
      name: "Persona Inexistente"
    });

    expect(decision).toBeNull();
  });
});
