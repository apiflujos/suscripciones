import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicCheckoutKind } from "@prisma/client";

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn()
}));

const { listCatalogProductsMock } = vi.hoisted(() => ({
  listCatalogProductsMock: vi.fn()
}));

const { findManyMock, findUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("@suscripciones/database", () => ({
  prisma: {
    publicCheckoutTemplate: {
      create: createMock,
      findMany: findManyMock,
      findUnique: findUniqueMock
    }
  }
}));

vi.mock("../products", () => ({
  listCatalogProducts: listCatalogProductsMock
}));

import { createCheckoutTemplate, findCheckoutTemplateForProductOrDefault, listCheckoutSelectableProducts } from "../checkoutTemplates";

describe("checkout templates service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows multiple products for CART templates", async () => {
    createMock.mockResolvedValue({ id: "tpl-1" });

    const result = await createCheckoutTemplate({
      name: "Catalogo",
      kind: PublicCheckoutKind.CART,
      tenantId: "tenant-1",
      productIds: [{ id: "prod-1", mode: "AUTO_LINK" }, { id: "prod-2", mode: "AUTO_DEBIT" }]
    });

    expect(result.ok).toBe(true);
  });

  it("returns tenant catalog when CART allows product selection", async () => {
    listCatalogProductsMock.mockResolvedValue({ items: [{ id: "prod-1" }, { id: "prod-2" }], total: 2 });

    const result = await listCheckoutSelectableProducts({
      template: {
        kind: PublicCheckoutKind.CART,
        tenantId: "tenant-1",
        allowProductSelect: true,
        productIds: [{ id: "prod-fixed", mode: "AUTO_LINK" }]
      }
    });

    expect(listCatalogProductsMock).toHaveBeenCalledWith({ tenantId: "tenant-1", take: 500 });
    expect(result.items).toHaveLength(2);
  });

  it("falls back to the configured default template when there is no product match", async () => {
    findManyMock.mockResolvedValue([
      { id: "tpl-default", active: true, kind: PublicCheckoutKind.SUBSCRIPTION, tenantId: "tenant-1", productIds: [] }
    ]);
    findUniqueMock.mockResolvedValue(null);

    const result = await findCheckoutTemplateForProductOrDefault({
      tenantId: "tenant-1",
      kind: PublicCheckoutKind.SUBSCRIPTION,
      productId: "prod-missing",
      defaultTemplateId: "tpl-default"
    });

    expect(result?.id).toBe("tpl-default");
  });
});
