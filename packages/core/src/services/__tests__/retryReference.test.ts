import { beforeEach, describe, expect, it, vi } from "vitest";

const payments: Array<{ reference: string }> = [];
const attempts: Array<{ reference: string }> = [];

vi.mock("../../db/prisma", () => ({
  prisma: {
    payment: { findMany: async ({ where }: any) => payments.filter((p) => p.reference.startsWith(where.reference.startsWith)) },
    paymentAttempt: { findMany: async ({ where }: any) => attempts.filter((p) => p.reference.startsWith(where.reference.startsWith)) }
  }
}));

import { nextRetryReference } from "../retryReference";

const BASE = "SUB_706c4185-f979-47c3-899d-ec3acd2d3d94_9";

describe("nextRetryReference", () => {
  beforeEach(() => {
    payments.length = 0;
    attempts.length = 0;
  });

  it("sin referencias previas empieza en R1", async () => {
    expect(await nextRetryReference(BASE)).toBe(`${BASE}_R1`);
  });

  it("no repite una referencia ya usada aunque su pago ya no cuente para el ciclo", async () => {
    // El pago del 30 de septiembre usó _R1; se desvinculó del ciclo, pero Wompi sigue
    // teniendo esa referencia. Contar pagos del ciclo daba 0 y volvía a generar _R1.
    payments.push({ reference: `${BASE}_R1` });
    expect(await nextRetryReference(BASE)).toBe(`${BASE}_R2`);
  });

  it("toma el mayor sufijo de pagos e intentos", async () => {
    payments.push({ reference: BASE }, { reference: `${BASE}_R1` });
    attempts.push({ reference: `${BASE}_R4` }, { reference: `${BASE}_R2` });
    expect(await nextRetryReference(BASE)).toBe(`${BASE}_R5`);
  });

  it("parte de la base aunque reciba una referencia que ya trae sufijo", async () => {
    payments.push({ reference: `${BASE}_R3` });
    expect(await nextRetryReference(`${BASE}_R3`)).toBe(`${BASE}_R4`);
  });

  it("ignora referencias de otro ciclo cuyo número empieza igual", async () => {
    payments.push({ reference: "SUB_706c4185-f979-47c3-899d-ec3acd2d3d94_90_R7" });
    expect(await nextRetryReference(BASE)).toBe(`${BASE}_R1`);
  });
});
