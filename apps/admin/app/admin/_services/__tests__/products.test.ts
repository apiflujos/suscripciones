import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("@suscripciones/database", () => ({
  prisma: {
    subscriptionPlan: {
      findUnique: findUniqueMock
    }
  }
}));

import { getCatalogProductById } from "../products";

describe("catalog products service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides inactive catalog products from fetch-by-id flows", async () => {
    findUniqueMock.mockResolvedValue({
      id: "prod_1",
      active: false,
      tenantId: "tenant_1",
      tenantLinks: [],
      metadata: { kind: "CATALOG_ITEM" }
    });

    const result = await getCatalogProductById({ productId: "prod_1", tenantId: "tenant_1" });

    expect(result).toEqual({ ok: false, status: 404, error: "not_found" });
  });

  it("returns active catalog products normally", async () => {
    findUniqueMock.mockResolvedValue({
      id: "prod_2",
      active: true,
      tenantId: "tenant_1",
      tenantLinks: [],
      name: "[SKU-1] Producto activo",
      currency: "COP",
      priceInCents: 1200000,
      intervalUnit: "MONTH",
      intervalCount: 1,
      metadata: {
        kind: "CATALOG_ITEM",
        displayName: "Producto activo",
        sku: "SKU-1",
        itemKind: "PRODUCT"
      },
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z")
    });

    const result = await getCatalogProductById({ productId: "prod_2", tenantId: "tenant_1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.id).toBe("prod_2");
      expect(result.item.name).toBe("Producto activo");
      expect(result.item.sku).toBe("SKU-1");
    }
  });
});
