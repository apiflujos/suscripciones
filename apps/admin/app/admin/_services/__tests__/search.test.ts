import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchActiveProductsMock, listEmpresasMock, customerFindManyMock } = vi.hoisted(() => ({
  searchActiveProductsMock: vi.fn(),
  listEmpresasMock: vi.fn(),
  customerFindManyMock: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("../products", () => ({
  searchActiveProducts: searchActiveProductsMock
}));

vi.mock("../companies", () => ({
  listEmpresas: listEmpresasMock
}));

vi.mock("@suscripciones/database", () => ({
  prisma: {
    customer: {
      findMany: customerFindManyMock
    }
  }
}));

import { searchCustomers, searchEmpresas, searchProducts } from "../search";

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

  it("returns recent customers when query is empty", async () => {
    customerFindManyMock.mockResolvedValue([
      { id: "cus_1", name: "Ana", email: "ana@test.com", phone: "300", metadata: null, tenantId: "tenant_1", tenantLinks: [] }
    ]);

    const result = await searchCustomers({ q: "", take: 10, tenantId: "tenant_1" });

    expect(customerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ tenantId: "tenant_1" }, { tenantLinks: { some: { tenantId: "tenant_1" } } }] }]
        }),
        take: 10
      })
    );
    expect(result).toHaveLength(1);
  });

  it("delegates empresa search to companies service", async () => {
    listEmpresasMock.mockResolvedValue({ items: [{ id: "emp_1", nombre: "Acme" }] });

    const result = await searchEmpresas({ q: "", take: 12, tenantId: "tenant_1" });

    expect(listEmpresasMock).toHaveBeenCalledWith({ q: "", take: 12, tenantId: "tenant_1" });
    expect(result).toEqual([
      {
        id: "emp_1",
        nombre: "Acme",
        email: undefined,
        telefono: undefined,
        direccion: undefined,
        sitioWeb: undefined,
        contactoPrincipalId: null
      }
    ]);
  });
});
