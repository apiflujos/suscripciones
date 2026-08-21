import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) => createElement("a", { href, className }, children)
}));

type Board = import("../../admin/_services/subscriptionsBoard").SubscriptionsBoard;
let Summary: typeof import("../CollectionSummary").CollectionSummary;

beforeAll(async () => {
  Summary = (await import("../CollectionSummary")).CollectionSummary;
});

function board(over: Partial<Board["totals"]> = {}, byMode: Board["byMode"] = []): Board {
  return {
    totals: {
      subscriptions: 29,
      mrrInCents: 1_500_000,
      expectedInCents: 1_500_000,
      collectedInCents: 1_000_000,
      pendingInCents: 500_000,
      current: 5,
      inGrace: 24,
      overdue: 0,
      currentInCents: 500_000,
      inGraceInCents: 1_000_000,
      overdueInCents: 0,
      notNotified: 4,
      withoutCard: 2,
      unscheduled: 1,
      ...over
    },
    byMode,
    rows: []
  };
}

const render = (b: Board) =>
  renderToStaticMarkup(createElement(Summary, { board: b, listHref: "/billing" }));

describe("CollectionSummary", () => {
  it("es un resumen, no una lista: sin tabla ni filtros", () => {
    const html = render(board());
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Buscar");
    expect(html).not.toContain("sb-chip");
  });

  it("se puede plegar y encabeza con lo cobrado del ciclo", () => {
    const html = render(board());
    expect(html).toContain("<details");
    expect(html).toContain("Cobranza del ciclo vigente");
    expect(html).toContain("$10.000");
    expect(html).toContain("de $15.000");
    expect(html).toContain("(67%)");
  });

  it("cada estado lleva a la lista de suscripciones filtrada", () => {
    const html = render(board());
    expect(html).toContain('href="/billing?state=AL_DIA"');
    expect(html).toContain('href="/billing?state=EN_GRACIA"');
    expect(html).toContain('href="/billing?state=EN_MORA"');
    expect(html).toContain("Ver y operar en suscripciones");
  });

  it("resume el riesgo en una línea", () => {
    const html = render(board());
    expect(html).toContain("4 sin avisar · 2 sin tarjeta · 1 sin cobro programado");
  });

  it("sin riesgo no inventa la línea de atención", () => {
    const html = render(board({ notNotified: 0, withoutCard: 0, unscheduled: 0 }));
    expect(html).not.toContain("Atención:");
  });

  it("el desglose por modo solo aparece si hay más de uno", () => {
    const unModo = render(board({}, [{ mode: "AUTO_DEBIT" } as never]));
    expect(unModo).not.toContain("Por modo de cobro");

    const dosModos = render(
      board({}, [
        { mode: "AUTO_DEBIT", subscriptions: 20, expectedInCents: 1_000_000, collectedInCents: 800_000, overdue: 0, unscheduled: 0 } as never,
        { mode: "MANUAL_LINK", subscriptions: 9, expectedInCents: 500_000, collectedInCents: 200_000, overdue: 2, unscheduled: 1 } as never
      ])
    );
    expect(dosModos).toContain("Por modo de cobro");
    expect(dosModos).toContain("Cobro manual");
    expect(dosModos).toContain("2 en mora");
  });

  it("sin cartera lo dice y no pinta números vacíos", () => {
    const html = render(board({ subscriptions: 0 }));
    expect(html).toContain("No hay suscripciones activas");
    expect(html).not.toContain("cs-states");
  });
});
