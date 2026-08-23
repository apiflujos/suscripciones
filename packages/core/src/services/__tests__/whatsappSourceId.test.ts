import { describe, expect, it } from "vitest";
import { isValidWhatsappSourceId, normalizeWhatsappSourceId } from "../chatwootSync";

// Un inbox de WhatsApp valida el source_id contra \A\d{1,15}\z. Si lo que se le
// manda no cumple, Chatwoot responde 422 y el aviso se pierde entero: no hay
// reintento que lo salve porque el dato de entrada es el que está mal.
describe("source_id de WhatsApp", () => {
  it("le pone el indicativo a los celulares colombianos de 10 dígitos", () => {
    expect(normalizeWhatsappSourceId("3147791306")).toBe("573147791306");
  });

  it("acepta el número ya internacional y le quita el '+'", () => {
    // Este es el formato que rompía: el '+' no pasa la expresión regular.
    expect(normalizeWhatsappSourceId("+573217603910")).toBe("573217603910");
  });

  it("limpia espacios, guiones y paréntesis", () => {
    expect(normalizeWhatsappSourceId(" (311) 339-9934 ")).toBe("573113399934");
  });

  it("devuelve indefinido cuando no hay teléfono", () => {
    expect(normalizeWhatsappSourceId("")).toBeUndefined();
    expect(normalizeWhatsappSourceId(null)).toBeUndefined();
    expect(normalizeWhatsappSourceId("sin número")).toBeUndefined();
  });

  it("descarta lo que no cabe en 15 dígitos en vez de mandarlo y que falle allá", () => {
    expect(normalizeWhatsappSourceId("1234567890123456")).toBeUndefined();
  });

  it("todo lo que produce pasa la validación de Chatwoot", () => {
    for (const entrada of ["3147791306", "+573217603910", "573104362040", "(311) 339-9934"]) {
      const salida = normalizeWhatsappSourceId(entrada);
      expect(isValidWhatsappSourceId(salida)).toBe(true);
    }
  });

  it("rechaza el '+' como source_id válido", () => {
    expect(isValidWhatsappSourceId("+573217603910")).toBe(false);
  });
});
