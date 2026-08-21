import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) => createElement("a", { href, className }, children)
}));

type Timeline = import("../../admin/_services/subscriptionTimeline").SubscriptionTimeline;

let Detail: typeof import("../SubscriptionRowDetail").SubscriptionRowDetail;

beforeAll(async () => {
  Detail = (await import("../SubscriptionRowDetail")).SubscriptionRowDetail;
});

function timeline(over: Partial<Timeline> = {}): Timeline {
  return {
    subscriptionId: "sub-1",
    customerId: "cus-1",
    customerName: "Ana Gómez",
    customerPhone: "+573001112233",
    planName: "Plan Mensual",
    tenantId: "ten-1",
    mode: "AUTO_DEBIT",
    subscriptionStatus: "ACTIVE",
    amountInCents: 100_000,
    hasCard: true,
    done: [{ at: "2026-07-14T10:00:00.000Z", title: "Ciclo 1 cobrado", detail: "$1.000", tone: "ok" }],
    pending: [{ at: "2026-08-15T00:00:00.000Z", title: "Ciclo 2 sin cobrar", detail: "$1.000 · PENDING", tone: "bad" }],
    scheduled: [{ at: "2026-08-21T14:00:00.000Z", title: "Aviso de vencimiento o mora", detail: "vencimiento", tone: "muted" }],
    cycles: [
      {
        cycleNumber: 2,
        periodStartAt: "2026-08-01T00:00:00.000Z",
        periodEndAt: "2026-09-01T00:00:00.000Z",
        dueAt: "2026-08-15T00:00:00.000Z",
        status: "PENDING",
        paidAt: null,
        daysLate: null,
        amountInCents: 100_000
      }
    ],
    truncated: false,
    ...over
  };
}

function render(t: Timeline, opts: { manualChargeEnabled?: boolean } = {}) {
  return renderToStaticMarkup(
    createElement(Detail, {
      timeline: t,
      csrfToken: "csrf-123",
      returnTo: "/?g=day&open=sub-1",
      closeHref: "/?g=day",
      manualChargeEnabled: opts.manualChargeEnabled ?? true,
      manualMarkPaidEnabled: true,
      chargeSubscriptionNow: () => {},
      markSubscriptionPaidManual: () => {}
    })
  );
}

describe("SubscriptionRowDetail", () => {
  it("las secciones van en orden: falta, se va a ejecutar, se hizo, ciclos, ejecutar", () => {
    const html = render(timeline());
    const order = ["Lo que falta", "Lo que se va a ejecutar", "Lo que se hizo", "Ciclos de cobro", "Ejecutar ahora"];
    const positions = order.map((label) => html.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("lo urgente y lo agendado quedan abiertos; el historial no", () => {
    const html = render(timeline());
    const abierta = (label: string) => {
      const i = html.indexOf(label);
      const summaryStart = html.lastIndexOf("<details", i);
      return html.slice(summaryStart, i).includes("open");
    };
    expect(abierta("Lo que falta")).toBe(true);
    expect(abierta("Lo que se va a ejecutar")).toBe(true);
    expect(abierta("Lo que se hizo")).toBe(false);
  });

  it("cuenta cada sección y muestra su contenido", () => {
    const html = render(timeline());
    expect(html).toContain("Ciclo 2 sin cobrar");
    expect(html).toContain("Aviso de vencimiento o mora");
    expect(html).toContain("Ciclo 1 cobrado");
  });

  it("cuando no hay nada agendado lo dice, en vez de dejar el hueco", () => {
    const html = render(timeline({ scheduled: [] }));
    expect(html).toContain("No hay nada agendado para esta suscripción");
  });

  it("avisa si quedaron trabajos fuera del listado", () => {
    const html = render(timeline({ truncated: true }));
    expect(html).toContain("Hay más trabajos agendados");
  });

  it("las acciones llevan el csrf y el retorno al tablero", () => {
    const html = render(timeline());
    expect(html).toContain('name="csrf" value="csrf-123"');
    expect(html).toContain('name="returnTo" value="/?g=day&amp;open=sub-1"');
    expect(html).toContain('name="subscriptionId" value="sub-1"');
  });

  it("cobrar solo aparece en débito automático", () => {
    expect(render(timeline())).toContain("Cobrar");
    const manual = render(timeline({ mode: "MANUAL_LINK" }));
    expect(manual).not.toContain(">Cobrar<");
    // Marcar pagado sirve para cualquier modo.
    expect(manual).toContain("Marcar");
  });

  it("sin tarjeta, cobrar queda desactivado", () => {
    const html = render(timeline({ hasCard: false }));
    expect(html).toContain('aria-disabled="true"');
  });

  it("ofrece la ficha completa para lo que no se ejecuta desde aquí", () => {
    const html = render(timeline());
    expect(html).toContain('href="/billing?subscriptionId=sub-1"');
  });

  it("el cierre vuelve al tablero sin la fila abierta", () => {
    const html = render(timeline());
    expect(html).toContain('href="/?g=day"');
  });
});
