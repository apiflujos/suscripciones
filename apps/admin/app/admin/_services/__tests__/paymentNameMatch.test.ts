import { describe, expect, it } from "vitest";
import { matchesQuery, namesLookRelated, samePhone } from "../paymentNameMatch";

describe("namesLookRelated", () => {
  it("une los nombres que usa el webhook con los del contacto", () => {
    expect(namesLookRelated("Lina Cruz", "Lina Marcela Cruz")).toBe(true);
    expect(namesLookRelated("Tomas Pineda", "Tomás Pineda")).toBe(true);
    expect(namesLookRelated("Elsa Echavarria Saldarriaga", "Maria Elsa Echavarría")).toBe(true);
    expect(namesLookRelated("CARLOS MANUEL URIBE LALINDE", "Carlos Manuel Uribe")).toBe(true);
  });

  it("no mezcla personas distintas con una sola palabra en común", () => {
    expect(namesLookRelated("Juan Gonzalez", "Juan Lozano")).toBe(false);
    expect(namesLookRelated("Tomas Pineda", "Lina pineda")).toBe(false);
    expect(namesLookRelated("", "Lina Cruz")).toBe(false);
  });
});

describe("samePhone / matchesQuery", () => {
  it("compara teléfonos por sus últimos 10 dígitos", () => {
    expect(samePhone("+57 311 308 8929", "3113088929")).toBe(true);
    expect(samePhone("3113088929", "3113088930")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });

  it("busca sin acentos ni mayúsculas, y por teléfono", () => {
    expect(matchesQuery("Elsa Echavarría", "echavarria")).toBe(true);
    expect(matchesQuery("Lina Cruz", "lina pineda")).toBe(false);
    expect(matchesQuery("+57 311 308 8929", "3113088929")).toBe(true);
  });
});
