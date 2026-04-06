import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchActiveProductsMock } = vi.hoisted(() => ({
  searchActiveProductsMock: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("../products", () => ({
  searchActiveProducts: searchActiveProductsMock
}));

vi.mock("@suscripciones/database", () => ({
  prisma: {}
}));

import { searchProducts } from "../search";

describe("admin product search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the active-products source of truth", async () => {
    const items = [{ id: "prod_1", name: "Producto activo" }];
    searchActiveProductsMock.mockResolvedValue(items);

    const result = await searchProducts({ q: "activo", take: 25, tenantId: "tenant_1" });

    expect(searchActiveProductsMock).toHaveBeenCalledWith({
      q: "activo",
      take: 25,
      tenantId: "tenant_1"
    });
    expect(result).toEqual(items);
  });
});
