import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@suscripciones/database", () => ({ prisma: {} }));
vi.mock("@suscripciones/core/services/subscriptionMode", () => ({
  resolveSubscriptionCollectionMode: vi.fn(() => "AUTO_DEBIT")
}));
vi.mock("@suscripciones/core/services/subscriptionBilling", () => ({
  readSubscriptionTotalInCents: vi.fn(() => 0)
}));
vi.mock("@suscripciones/core/services/billingCycles", () => ({
  resolveCollectionDelinquency: vi.fn(() => ({ status: "AL_DIA", daysPastDue: 0 }))
}));
vi.mock("@suscripciones/core/lib/customerMetadata", () => ({
  hasActiveCustomerPaymentSource: vi.fn(() => true)
}));

type Board = typeof import("../subscriptionsBoard");
type Row = import("../subscriptionsBoard").SubscriptionBoardRow;

let mod: Board;

beforeAll(async () => {
  mod = await import("../subscriptionsBoard");
});

function row(over: Partial<Row>): Row {
  return {
    subscriptionId: "sub-1",
    customerName: "Ana Gómez",
    customerPhone: "+573001112233",
    planName: "Plan Mensual",
    mode: "AUTO_DEBIT",
    subscriptionStatus: "ACTIVE",
    amountInCents: 100_000,
    cycleNumber: 3,
    cycleDueAt: "2026-08-15T05:00:00.000Z",
    cycleStatus: "PAID",
    delinquency: "AL_DIA",
    daysPastDue: 0,
    hasCard: true,
    lastPaymentStatus: "APPROVED",
    lastPaymentAt: "2026-08-15T06:00:00.000Z",
    messageDelivered: true,
    messageError: null,
    messageContent: "Tu cobro fue exitoso",
    ...over
  };
}

describe("filterBoardRows", () => {
  const rows = [
    row({ subscriptionId: "a", mode: "AUTO_DEBIT", delinquency: "AL_DIA" }),
    row({ subscriptionId: "b", mode: "MANUAL_LINK", delinquency: "EN_MORA", customerName: "Beto Ruiz", messageDelivered: null }),
    row({ subscriptionId: "c", mode: "AUTO_LINK", delinquency: "EN_GRACIA", customerName: "Carla Díaz", messageDelivered: false })
  ];

  it("sin filtros devuelve todo", () => {
    expect(mod.filterBoardRows(rows, {}).map((r) => r.subscriptionId)).toEqual(["a", "b", "c"]);
  });

  it("filtra por modo y por estado de cobranza", () => {
    expect(mod.filterBoardRows(rows, { mode: "manual_link" }).map((r) => r.subscriptionId)).toEqual(["b"]);
    expect(mod.filterBoardRows(rows, { state: "EN_MORA" }).map((r) => r.subscriptionId)).toEqual(["b"]);
  });

  it("'sin avisar' incluye a quien nunca recibió y a quien falló", () => {
    expect(mod.filterBoardRows(rows, { notified: "no" }).map((r) => r.subscriptionId)).toEqual(["b", "c"]);
  });

  it("'aviso falló' deja solo los envíos rechazados", () => {
    expect(mod.filterBoardRows(rows, { notified: "failed" }).map((r) => r.subscriptionId)).toEqual(["c"]);
  });

  it("busca por nombre, plan o teléfono sin importar mayúsculas", () => {
    expect(mod.filterBoardRows(rows, { q: "carla" }).map((r) => r.subscriptionId)).toEqual(["c"]);
    expect(mod.filterBoardRows(rows, { q: "3001112233" })).toHaveLength(3);
    expect(mod.filterBoardRows(rows, { q: "nadie" })).toHaveLength(0);
  });

  it("ignora los acentos en ambos sentidos", () => {
    expect(mod.filterBoardRows(rows, { q: "gomez" }).map((r) => r.subscriptionId)).toEqual(["a"]);
    expect(mod.filterBoardRows(rows, { q: "díaz" }).map((r) => r.subscriptionId)).toEqual(["c"]);
    expect(mod.filterBoardRows(rows, { q: "diaz" }).map((r) => r.subscriptionId)).toEqual(["c"]);
  });

  it("encuentra el teléfono aunque se escriba con espacios o guiones", () => {
    expect(mod.filterBoardRows(rows, { q: "300 111-22 33" })).toHaveLength(3);
    expect(mod.filterBoardRows(rows, { q: "+57 300 111 22 33" })).toHaveLength(3);
    expect(mod.filterBoardRows(rows, { q: "999 888" })).toHaveLength(0);
  });

  it("un espacio en blanco no filtra nada", () => {
    expect(mod.filterBoardRows(rows, { q: "   " })).toHaveLength(3);
  });

  it("acumula filtros", () => {
    expect(mod.filterBoardRows(rows, { mode: "AUTO_LINK", state: "EN_MORA" })).toHaveLength(0);
  });
});

describe("summarizeBoardRows", () => {
  it("separa cobrado de pendiente según el estado del ciclo", () => {
    const { totals, byMode } = mod.summarizeBoardRows([
      row({ subscriptionId: "a", cycleStatus: "PAID", amountInCents: 100_000 }),
      row({ subscriptionId: "b", cycleStatus: "PENDING", amountInCents: 50_000, delinquency: "EN_MORA", daysPastDue: 4 })
    ]);

    expect(totals.subscriptions).toBe(2);
    expect(totals.expectedInCents).toBe(150_000);
    expect(totals.collectedInCents).toBe(100_000);
    expect(totals.pendingInCents).toBe(50_000);
    expect(totals.overdue).toBe(1);
    expect(totals.overdueInCents).toBe(50_000);
    expect(byMode).toHaveLength(1);
    expect(byMode[0]).toMatchObject({ mode: "AUTO_DEBIT", paid: 1, overdue: 1 });
  });

  it("cuenta como riesgo lo que no se cobró y no se avisó, y las tarjetas faltantes", () => {
    const { totals } = mod.summarizeBoardRows([
      row({ subscriptionId: "a", cycleStatus: "PENDING", messageDelivered: null, hasCard: false }),
      row({ subscriptionId: "b", cycleStatus: "PAID", messageDelivered: null, hasCard: true })
    ]);

    // El ciclo ya pagado no necesita aviso: no suma riesgo.
    expect(totals.notNotified).toBe(1);
    expect(totals.withoutCard).toBe(1);
  });

  it("los totales cuadran con el desglose por modo", () => {
    const { totals, byMode } = mod.summarizeBoardRows([
      row({ subscriptionId: "a", mode: "AUTO_DEBIT", cycleStatus: "PAID", amountInCents: 100_000 }),
      row({ subscriptionId: "b", mode: "AUTO_LINK", cycleStatus: "PENDING", amountInCents: 50_000, delinquency: "EN_GRACIA" }),
      row({ subscriptionId: "c", mode: "MANUAL_LINK", cycleStatus: "PENDING", amountInCents: 20_000, delinquency: "EN_MORA", messageDelivered: null })
    ]);

    const sum = (key: "expectedInCents" | "collectedInCents" | "pendingInCents" | "notNotified" | "withoutCard") =>
      byMode.reduce((acc, s) => acc + s[key], 0);

    expect(sum("expectedInCents")).toBe(totals.expectedInCents);
    expect(sum("collectedInCents")).toBe(totals.collectedInCents);
    expect(sum("pendingInCents")).toBe(totals.pendingInCents);
    expect(sum("notNotified")).toBe(totals.notNotified);
    expect(sum("withoutCard")).toBe(totals.withoutCard);
    expect(totals.collectedInCents + totals.pendingInCents).toBe(totals.expectedInCents);
    expect(totals.current + totals.inGrace + totals.overdue).toBe(totals.subscriptions);
  });

  it("mantiene el orden de los modos", () => {
    const { byMode } = mod.summarizeBoardRows([
      row({ subscriptionId: "a", mode: "MANUAL_LINK" }),
      row({ subscriptionId: "b", mode: "AUTO_DEBIT" }),
      row({ subscriptionId: "c", mode: "AUTO_LINK" })
    ]);
    expect(byMode.map((s) => s.mode)).toEqual(["AUTO_DEBIT", "AUTO_LINK", "MANUAL_LINK"]);
  });

  it("un estado inesperado no descuadra las tres cifras", () => {
    const { totals } = mod.summarizeBoardRows([
      row({ subscriptionId: "a", delinquency: "OTRO" as never, amountInCents: 7_000 }),
      row({ subscriptionId: "b", delinquency: "EN_MORA", amountInCents: 3_000 })
    ]);
    expect(totals.current + totals.inGrace + totals.overdue).toBe(totals.subscriptions);
    expect(totals.currentInCents + totals.inGraceInCents + totals.overdueInCents).toBe(totals.mrrInCents);
  });

  it("un modo inesperado no desaparece del desglose", () => {
    const { totals, byMode } = mod.summarizeBoardRows([
      row({ subscriptionId: "a", mode: "OTRO" as never, amountInCents: 10_000, cycleStatus: "PENDING" })
    ]);
    expect(byMode.map((s) => s.mode)).toEqual(["OTRO"]);
    expect(totals.pendingInCents).toBe(10_000);
  });

  it("un modo sin filas no aparece en el desglose", () => {
    const { byMode } = mod.summarizeBoardRows([row({ mode: "MANUAL_LINK" })]);
    expect(byMode.map((s) => s.mode)).toEqual(["MANUAL_LINK"]);
  });

  it("sin filas devuelve todo en cero", () => {
    const { totals, byMode } = mod.summarizeBoardRows([]);
    expect(byMode).toEqual([]);
    expect(totals).toMatchObject({ subscriptions: 0, expectedInCents: 0, collectedInCents: 0, overdue: 0 });
  });
});

describe("applyBoardFilter", () => {
  it("el resumen habla del recorte visible, no de la cartera entera", () => {
    const board = {
      totals: {} as never,
      byMode: [],
      rows: [
        row({ subscriptionId: "a", delinquency: "AL_DIA", cycleStatus: "PAID", amountInCents: 100_000 }),
        row({ subscriptionId: "b", delinquency: "EN_MORA", cycleStatus: "PENDING", amountInCents: 30_000 })
      ]
    };

    const filtered = mod.applyBoardFilter(board, { state: "EN_MORA" });

    expect(filtered.rows.map((r) => r.subscriptionId)).toEqual(["b"]);
    expect(filtered.totals.subscriptions).toBe(1);
    expect(filtered.totals.current).toBe(0);
    expect(filtered.totals.overdue).toBe(1);
    expect(filtered.totals.mrrInCents).toBe(30_000);
    expect(filtered.byMode[0].subscriptions).toBe(1);
  });
});
