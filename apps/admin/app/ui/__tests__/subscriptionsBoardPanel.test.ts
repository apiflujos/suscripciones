import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never)
}));

type Row = import("../../admin/_services/subscriptionsBoard").SubscriptionBoardRow;
type Board = import("../../admin/_services/subscriptionsBoard").SubscriptionsBoard;

let service: typeof import("../../admin/_services/subscriptionsBoard");
let Panel: typeof import("../SubscriptionsBoard").SubscriptionsBoardPanel;

beforeAll(async () => {
  service = await import("../../admin/_services/subscriptionsBoard");
  Panel = (await import("../SubscriptionsBoard")).SubscriptionsBoardPanel;
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

function boardOf(rows: Row[]): Board {
  return { ...service.summarizeBoardRows(rows), rows };
}

// Mismo armado de parámetros que hace page.tsx: los filtros activos viajan en
// la base, para que un chip nuevo se sume a los que ya están puestos.
function render(board: Board, filter: Record<string, string>) {
  const filters = { mode: "", state: "", notified: "", q: "", ...filter };
  const baseParams = new URLSearchParams({ g: "day" });
  Object.entries(filters).forEach(([k, v]) => {
    if (v) baseParams.set(k, v);
  });
  return renderToStaticMarkup(
    createElement(Panel, {
      board,
      filtered: service.applyBoardFilter(board, filters),
      filters,
      baseParams,
      exportHref: "/api/subscriptions/export"
    })
  );
}

const cartera = [
  row({ subscriptionId: "a", customerName: "Ana Gómez", delinquency: "AL_DIA", cycleStatus: "PAID", amountInCents: 100_000 }),
  row({ subscriptionId: "b", customerName: "Beto Ruiz", delinquency: "EN_MORA", cycleStatus: "PENDING", amountInCents: 30_000, messageDelivered: null }),
  row({ subscriptionId: "c", customerName: "Carla Díaz", delinquency: "EN_GRACIA", cycleStatus: "PENDING", amountInCents: 20_000, messageDelivered: false })
];

describe("SubscriptionsBoardPanel", () => {
  it("sin filtro muestra la cartera completa", () => {
    const html = render(boardOf(cartera), {});
    expect(html).toContain("Ana Gómez");
    expect(html).toContain("Beto Ruiz");
    expect(html).toContain("Carla Díaz");
    expect(html).toContain("3 suscripciones");
  });

  it("con filtro los totales hablan del recorte, no de la cartera entera", () => {
    const html = render(boardOf(cartera), { state: "EN_MORA" });

    expect(html).toContain("Beto Ruiz");
    expect(html).not.toContain("Ana Gómez");
    expect(html).not.toContain("Carla Díaz");
    // Contador del filtro: 1 de 3.
    expect(html).toContain("1 de 3 suscripciones");
    // La cartera activa del recorte es 1, no 3, y su monto el del moroso.
    expect(html).toContain('<div class="sb-kpi-value">1</div>');
    expect(html).toContain("$300 por ciclo");
    // Los tiles de estado: nadie al día ni en gracia dentro del recorte.
    expect(html).toMatch(/sb-state is-ok"><span class="sb-state-n">0</);
    expect(html).toMatch(/sb-state is-bad"><span class="sb-state-n">1</);
  });

  it("un filtro sin resultados deja la barra para poder quitarlo", () => {
    const html = render(boardOf(cartera), { q: "nadie-con-ese-nombre" });
    expect(html).toContain("Ninguna suscripción coincide con el filtro");
    expect(html).toContain("Quitar filtros");
    expect(html).toContain("0 de 3 suscripciones");
    expect(html).not.toContain("No hay suscripciones activas");
  });

  it("sin cartera no se pinta la barra de filtros", () => {
    const html = render(boardOf([]), {});
    expect(html).toContain("No hay suscripciones activas");
    expect(html).not.toContain("sb-filters");
  });

  it("el cuerpo del WhatsApp entregado viaja como tooltip", () => {
    const html = render(boardOf([row({ messageDelivered: true, messageContent: "Tu cobro fue exitoso" })]), {});
    expect(html).toContain('title="Tu cobro fue exitoso"');
  });

  it("un filtro nuevo se suma al que ya está puesto", () => {
    const html = render(boardOf(cartera), { state: "EN_MORA" });
    // El chip de modo conserva el estado ya filtrado…
    expect(html).toContain('href="/?g=day&amp;state=EN_MORA&amp;mode=AUTO_DEBIT"');
    // …y "Quitar filtros" devuelve la URL limpia, sin perder el período.
    expect(html).toContain('href="/?g=day">Quitar filtros</a>');
    // La búsqueda arrastra los filtros activos como campos ocultos.
    expect(html).toContain('<input type="hidden" name="state" value="EN_MORA"/>');
  });

  it("la descarga apunta al mismo recorte que se está viendo", () => {
    const html = render(boardOf(cartera), { state: "EN_MORA" });
    expect(html).toContain('href="/api/subscriptions/export"');
    expect(html).toContain("Descargar Excel");
  });
});
