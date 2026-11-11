import { beforeEach, describe, expect, it, vi } from "vitest";

const listByRange = vi.fn();
const reconcile = vi.fn();
const eventFind = vi.fn();
const paymentFind = vi.fn();
const jobFind = vi.fn();

vi.mock("../../db/prisma", () => ({
  prisma: {
    webhookEvent: { findMany: (...a: any[]) => eventFind(...a) },
    payment: { findFirst: (...a: any[]) => paymentFind(...a) },
    retryJob: { findFirst: (...a: any[]) => jobFind(...a) }
  }
}));
vi.mock("../../providers/wompi/client", () => ({
  WompiClient: class {
    listTransactionsByDateRange(...a: any[]) { return listByRange(...a); }
  }
}));
vi.mock("../runtimeConfig", () => ({
  getWompiPublicKey: vi.fn().mockResolvedValue("pub_key"),
  getWompiPrivateKey: vi.fn().mockResolvedValue("prv_key"),
  getWompiApiBaseUrl: vi.fn().mockResolvedValue("https://wompi.test/v1"),
  getWompiCheckoutLinkBaseUrl: vi.fn().mockResolvedValue("https://checkout.test/l/")
}));
vi.mock("../wompiReconcile", () => ({ reconcileWompiTransaction: (...a: any[]) => reconcile(...a) }));
vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { recoverWompiTransactions } from "../wompiRecovery";

const tx = (id: string, status: string, raw: Record<string, unknown> = {}) => ({
  id, status, reference: `ref-${id}`, amountInCents: 5000000, currency: "COP", createdAt: "2026-11-09T15:00:00Z", raw
});

describe("recoverWompiTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventFind.mockResolvedValue([]);
    paymentFind.mockResolvedValue(null);
    jobFind.mockResolvedValue(null);
    reconcile.mockResolvedValue({ ok: true, reference: "ref" });
  });

  it("en vista previa lista solo los aprobados, marca los de Shopify y los que ya tenemos, y no escribe", async () => {
    listByRange.mockResolvedValue([
      tx("t1", "APPROVED", { redirect_url: "https://x.conexa.ai/wompi/continue-checkout/abc" }),
      tx("t2", "APPROVED"),
      tx("t3", "DECLINED"),
      tx("t4", "APPROVED")
    ]);
    eventFind.mockImplementation(async ({ where }: any) =>
      where.payload.equals === "t4" ? [{ id: "e4", processStatus: "PROCESSED" }] : []
    );
    const res = await recoverWompiTransactions({ fromDay: "2026-11-09", untilDay: "2026-11-11", apply: false });
    expect(res.items.map((i) => [i.id, i.outcome, i.shopify])).toEqual([
      ["t1", "pendiente", true],
      ["t2", "pendiente", false],
      ["t4", "ya_recibido", false]
    ]);
    expect(reconcile).not.toHaveBeenCalled();
    expect(listByRange.mock.calls[0][0]).toMatchObject({ authKey: "pub_key", fromDate: "2026-11-09", untilDate: "2026-11-11", page: 1 });
  });

  it("al aplicar recupera los que faltan y omite los que ya tenemos", async () => {
    listByRange.mockResolvedValue([tx("t1", "APPROVED"), tx("t2", "APPROVED")]);
    paymentFind.mockImplementation(async ({ where }: any) => (where.wompiTransactionId === "t2" ? { id: "p" } : null));
    const res = await recoverWompiTransactions({ fromDay: "2026-11-09", untilDay: "2026-11-11", apply: true });
    expect(res).toMatchObject({ recovered: 1, alreadyHad: 1, failed: 0 });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0]).toMatchObject({ wompiTransactionId: "t1", checksumPrefix: "recover" });
  });

  it("un evento que quedó registrado pero falló se recupera; uno ya reenviado a Shopify se omite", async () => {
    listByRange.mockResolvedValue([tx("t1", "APPROVED"), tx("t2", "APPROVED")]);
    eventFind.mockImplementation(async ({ where }: any) => [{ id: `e-${where.payload.equals}`, processStatus: "FAILED" }]);
    jobFind.mockImplementation(async ({ where }: any) => (where.payload.equals === "e-t2" ? { id: "j" } : null));
    const res = await recoverWompiTransactions({ fromDay: "2026-11-09", untilDay: "2026-11-11", apply: true });
    expect(res.items.map((i) => [i.id, i.outcome])).toEqual([["t1", "recuperado"], ["t2", "ya_recibido"]]);
    expect(reconcile.mock.calls.map((c) => c[0].wompiTransactionId)).toEqual(["t1"]);
  });

  it("cuenta como error el que Wompi no deja reconciliar, sin frenar los demás", async () => {
    listByRange.mockResolvedValue([tx("t1", "APPROVED"), tx("t2", "APPROVED")]);
    reconcile.mockResolvedValueOnce({ ok: false, reason: "wompi_api_unavailable" }).mockResolvedValueOnce({ ok: true });
    const res = await recoverWompiTransactions({ fromDay: "2026-11-09", untilDay: "2026-11-11", apply: true });
    expect(res).toMatchObject({ recovered: 1, failed: 1 });
    expect(res.items[0]).toMatchObject({ outcome: "error", detail: "wompi_api_unavailable" });
  });

  it("recorre varias páginas hasta que una viene incompleta", async () => {
    listByRange.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => tx(`a${i}`, "APPROVED"))).mockResolvedValueOnce([tx("b1", "APPROVED")]);
    const res = await recoverWompiTransactions({ fromDay: "2026-11-09", untilDay: "2026-11-11", apply: false });
    expect(res.items).toHaveLength(101);
    expect(listByRange).toHaveBeenCalledTimes(2);
  });

  it("si Wompi falla con la llave pública prueba la privada, y si ambas fallan devuelve el error", async () => {
    listByRange.mockRejectedValueOnce(new Error("401")).mockResolvedValueOnce([tx("t1", "APPROVED")]);
    const ok = await recoverWompiTransactions({ fromDay: "2026-11-09", untilDay: "2026-11-11", apply: false });
    expect(ok.items).toHaveLength(1);
    expect(listByRange.mock.calls[1][0].authKey).toBe("prv_key");

    listByRange.mockReset();
    listByRange.mockRejectedValue(new Error("Wompi list transactions failed: 422 {}"));
    const bad = await recoverWompiTransactions({ fromDay: "2026-11-09", untilDay: "2026-11-11", apply: false });
    expect(bad.error).toMatch(/422/);
    expect(bad.items).toEqual([]);
  });

  it("rechaza fechas inválidas o rangos de más de 31 días", async () => {
    expect((await recoverWompiTransactions({ fromDay: "09/11/2026", untilDay: "2026-11-11", apply: false })).error).toMatch(/AAAA-MM-DD/);
    expect((await recoverWompiTransactions({ fromDay: "2026-01-01", untilDay: "2026-11-11", apply: false })).error).toMatch(/31/);
    expect((await recoverWompiTransactions({ fromDay: "2026-11-11", untilDay: "2026-11-09", apply: false })).error).toMatch(/31/);
    expect(listByRange).not.toHaveBeenCalled();
  });

  it("con IDs puntuales no consulta el rango y reconcilia cada uno", async () => {
    const res = await recoverWompiTransactions({ ids: ["t1", " t2 ", "t1"], apply: true });
    expect(listByRange).not.toHaveBeenCalled();
    expect(reconcile.mock.calls.map((c) => c[0].wompiTransactionId)).toEqual(["t1", "t2"]);
    expect(res.recovered).toBe(2);
  });
});
