import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agendarTokenizacionSchema, validarEnlacePublicoPropio } from "../publicLinkSafety";

/**
 * Los enlaces que recibe el cliente por WhatsApp tienen que ser nuestros.
 *
 * Las rutas que agendan avisos aceptaban la URL en el cuerpo de la petición y la
 * pasaban tal cual a la plantilla. La única comprobación era descartar localhost,
 * así que con un token de integración se podía hacer que el número del negocio
 * mandara a los clientes un enlace a cualquier dominio, dentro de una plantilla
 * de cobro que parece legítima.
 */

const BASE = "https://mdv.sus.apiflujos.com";
let baseOriginal: string | undefined;

beforeEach(() => {
  baseOriginal = process.env.APP_PUBLIC_BASE_URL;
  process.env.APP_PUBLIC_BASE_URL = BASE;
});

afterEach(() => {
  if (baseOriginal === undefined) delete process.env.APP_PUBLIC_BASE_URL;
  else process.env.APP_PUBLIC_BASE_URL = baseOriginal;
});

describe("validarEnlacePublicoPropio", () => {
  it("acepta un enlace de la propia aplicación", () => {
    const r = validarEnlacePublicoPropio(`${BASE}/public/suscripcion/abc123`);
    expect(r.ok).toBe(true);
  });

  it("rechaza un dominio ajeno, que es el caso que abría la puerta al fraude", () => {
    const r = validarEnlacePublicoPropio("https://evil.example.com/pagar");
    expect(r).toEqual({ ok: false, motivo: "dominio_no_permitido" });
  });

  it("rechaza un subdominio parecido: no basta con que contenga el nombre", () => {
    const r = validarEnlacePublicoPropio("https://mdv.sus.apiflujos.com.evil.io/pagar");
    expect(r).toEqual({ ok: false, motivo: "dominio_no_permitido" });
  });

  it("rechaza lo que no es una URL", () => {
    expect(validarEnlacePublicoPropio("no soy una url").motivo).toBe("invalido");
    expect(validarEnlacePublicoPropio("").motivo).toBe("vacio");
    expect(validarEnlacePublicoPropio(null).motivo).toBe("vacio");
    // Un número no es "vacío": es un valor que no sirve como URL.
    expect(validarEnlacePublicoPropio(42).motivo).toBe("invalido");
    expect(validarEnlacePublicoPropio({}).motivo).toBe("invalido");
  });

  it("sigue rechazando localhost", () => {
    expect(validarEnlacePublicoPropio("http://localhost:3000/x").ok).toBe(false);
  });

  it("sin base pública configurada no bloquea, para no dejar mudo un entorno mal configurado", () => {
    delete process.env.APP_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const r = validarEnlacePublicoPropio("https://cualquiera.com/x");
    expect(r.ok).toBe(true);
  });
});

describe("agendarTokenizacionSchema", () => {
  it("exige cliente y enlace", () => {
    expect(agendarTokenizacionSchema.safeParse({}).success).toBe(false);
    expect(agendarTokenizacionSchema.safeParse({ customerId: "c1" }).success).toBe(false);
  });

  it("rechaza el cuerpo con un enlace de otro dominio", () => {
    const r = agendarTokenizacionSchema.safeParse({
      customerId: "c1",
      tokenUrl: "https://evil.example.com/pagar"
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/dominio público/i);
    }
  });

  it("normaliza los identificadores vacíos a nulo", () => {
    const r = agendarTokenizacionSchema.safeParse({
      customerId: "c1",
      tokenUrl: `${BASE}/public/suscripcion/abc`,
      tenantId: "",
      planId: "  ",
      productId: "p1"
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tenantId).toBeNull();
      expect(r.data.planId).toBeNull();
      expect(r.data.productId).toBe("p1");
    }
  });

  it("no se deja colar un objeto donde va la URL", () => {
    const r = agendarTokenizacionSchema.safeParse({
      customerId: "c1",
      tokenUrl: { toString: () => `${BASE}/x` }
    });
    expect(r.success).toBe(false);
  });
});
