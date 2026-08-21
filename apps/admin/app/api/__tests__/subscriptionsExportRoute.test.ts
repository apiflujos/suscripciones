import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  session: null as null | { email: string; role: string; tenantId?: string | null; iat: number; exp: number },
  rows: [] as any[],
  boardArgs: null as any,
  resolvedTenant: "uuid-resuelto"
};

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: "token-de-prueba" }) }))
}));
vi.mock("../../../lib/session", () => ({
  ADMIN_SESSION_COOKIE: "admin_session",
  verifyAdminSessionToken: vi.fn(async () => state.session)
}));
vi.mock("../../admin/_services/tenantResolver", () => ({
  resolveTenantId: vi.fn(async () => state.resolvedTenant)
}));
vi.mock("../../admin/_services/subscriptionsBoard", async () => {
  // El filtro real: es justamente lo que debe compartir con la pantalla.
  const actual = await vi.importActual<any>("../../admin/_services/subscriptionsBoard");
  return {
    ...actual,
    getSubscriptionsBoard: vi.fn(async (args: any) => {
      state.boardArgs = args;
      return { ...actual.summarizeBoardRows(state.rows), rows: state.rows };
    })
  };
});

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

async function get(url: string) {
  const { GET } = await import("../subscriptions/export/route");
  return GET(new Request(url));
}

function row(over: Record<string, unknown> = {}) {
  const merged = {
    subscriptionId: "sub-1",
    customerId: "cus-1",
    customerName: "Ana Gómez",
    customerPhone: "+573001112233",
    planName: "Plan Mensual",
    mode: "AUTO_DEBIT",
    subscriptionStatus: "ACTIVE",
    amountInCents: 100_000,
    cycleNumber: 3,
    cycleDueAt: "2026-08-15T05:00:00.000Z",
    cycleStatus: "PAID",
    cyclePaid: true,
    cyclePaidAt: "2026-08-14T05:00:00.000Z",
    delinquency: "AL_DIA",
    daysPastDue: 0,
    hasCard: true,
    nextCharge: null,
    notice: { kind: "Link de pago", status: "SENT", at: "2026-08-10T05:00:00.000Z", reason: null, content: "Tu cobro fue exitoso" },
    chargeFailure: null,
    ...over
  };
  return { ...merged, cyclePaid: merged.cycleStatus === "PAID" };
}

const AHORA = Math.floor(Date.parse("2026-08-20T20:00:00Z") / 1000);

beforeEach(() => {
  state.session = { email: "admin@x.com", role: "ADMIN", iat: AHORA, exp: AHORA + 3600 };
  state.rows = [row()];
  state.boardArgs = null;
  state.resolvedTenant = "uuid-resuelto";
});

describe("GET /api/subscriptions/export", () => {
  it("sin sesión no entrega nada", async () => {
    state.session = null;
    expect((await get("http://localhost/api/subscriptions/export")).status).toBe(401);
  });

  it("un rol sin permiso de suscripciones recibe 403", async () => {
    state.session = { email: "bot@x.com", role: "WEBHOOK", iat: AHORA, exp: AHORA + 3600 };
    expect((await get("http://localhost/api/subscriptions/export")).status).toBe(403);
  });

  it("un agente puede descargar: solo necesita lectura", async () => {
    state.session = { email: "agente@x.com", role: "AGENT", iat: AHORA, exp: AHORA + 3600 };
    const res = await get("http://localhost/api/subscriptions/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename="suscripciones-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("el CSV arranca con BOM, para que Excel respete los acentos", async () => {
    // Response.text() se come el BOM al decodificar, así que se miran los bytes.
    const bytes = new Uint8Array(await (await get("http://localhost/api/subscriptions/export")).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("lleva las 17 columnas acordadas", async () => {
    const csv = await (await get("http://localhost/api/subscriptions/export")).text();
    const [header] = csv.split("\r\n");
    expect(header.replace("﻿", "").split(",")).toHaveLength(17);
    expect(header).toContain("Mensaje enviado");
    expect(header).toContain("Teléfono");
    expect(header).toContain("Ciclo pagado");
    expect(header).toContain("Próximo cobro");
  });

  it("aplica el mismo filtro que la pantalla", async () => {
    state.rows = [
      row({ subscriptionId: "a", customerName: "Ana Gómez", delinquency: "AL_DIA" }),
      row({ subscriptionId: "b", customerName: "Beto Ruiz", delinquency: "EN_MORA", cycleStatus: "PENDING" })
    ];
    const csv = await (await get("http://localhost/api/subscriptions/export?state=EN_MORA")).text();
    expect(csv).toContain("Beto Ruiz");
    expect(csv).not.toContain("Ana Gómez");
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("resuelve el canal igual que el tablero", async () => {
    await get("http://localhost/api/subscriptions/export?tenantId=abc");
    expect(state.boardArgs).toEqual({ tenantId: "uuid-resuelto" });

    await get("http://localhost/api/subscriptions/export");
    expect(state.boardArgs).toEqual({ tenantId: null });
  });

  it("un nombre con fórmula no se ejecuta al abrir el archivo", async () => {
    state.rows = [row({ customerName: '=HYPERLINK("http://malo","cobra aquí")' })];
    const csv = await (await get("http://localhost/api/subscriptions/export")).text();
    expect(csv).toContain("\"'=HYPERLINK(");
  });

  it("el monto viaja como número, sin separadores", async () => {
    state.rows = [row({ amountInCents: 1_234_500 })];
    const csv = await (await get("http://localhost/api/subscriptions/export")).text();
    expect(csv.split("\r\n")[1]).toContain(",12345,");
  });
});
