import { describe, expect, it } from "vitest";
import {
  CANALES_TIEMPO_REAL,
  MAX_MENSAJE,
  MAX_PESOS,
  detallesDeError,
  enviarLinkDePagoSchema,
  enviarMensajeSchema,
  publicarTiempoRealSchema,
  reconciliarPagoSchema,
  reconciliarPendientesSchema
} from "../bodySchemas";

describe("publicarTiempoRealSchema — la lista blanca ya no falla abierta", () => {
  it("acepta los canales declarados", () => {
    for (const canal of CANALES_TIEMPO_REAL) {
      expect(publicarTiempoRealSchema.safeParse({ channel: canal }).success).toBe(true);
    }
  });

  it("rechaza un canal inventado", () => {
    // Antes `CHANNEL_PERMS[canal] || []` devolvía [] y el chequeo de permisos se
    // saltaba entero: cualquier canal fuera del mapa pasaba sin autorización.
    const r = publicarTiempoRealSchema.safeParse({ channel: "cualquier-cosa" });
    expect(r.success).toBe(false);
  });

  it("rechaza nombres que buscan colarse por el prototipo", () => {
    for (const canal of ["__proto__", "constructor", "toString"]) {
      expect(publicarTiempoRealSchema.safeParse({ channel: canal }).success).toBe(false);
    }
  });

  it("rechaza un payload enorme, que se difunde a todos los suscriptores", () => {
    const grande = { texto: "x".repeat(40 * 1024) };
    const r = publicarTiempoRealSchema.safeParse({ channel: "jobs", payload: grande });
    expect(r.success).toBe(false);
  });

  it("rechaza un payload con referencias circulares", () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    expect(publicarTiempoRealSchema.safeParse({ channel: "jobs", payload: circular }).success).toBe(false);
  });

  it("un payload ausente queda como objeto vacío, como antes", () => {
    const r = publicarTiempoRealSchema.safeParse({ channel: "jobs" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payload).toEqual({});
  });
});

describe("enviarLinkDePagoSchema — el importe tiene techo", () => {
  it("acepta un importe normal", () => {
    const r = enviarLinkDePagoSchema.safeParse({ customerId: "c1", amount: 390000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(390000);
  });

  it("sigue aceptando el importe como texto con separadores, como hacía antes", () => {
    const r = enviarLinkDePagoSchema.safeParse({ customerId: "c1", amount: "390.000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(390000);
  });

  it("rechaza cero y negativos", () => {
    expect(enviarLinkDePagoSchema.safeParse({ customerId: "c1", amount: 0 }).success).toBe(false);
    expect(enviarLinkDePagoSchema.safeParse({ customerId: "c1", amount: -5 }).success).toBe(false);
  });

  it("rechaza un cero de más: es el error real, no el ataque", () => {
    const r = enviarLinkDePagoSchema.safeParse({ customerId: "c1", amount: MAX_PESOS + 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(detallesDeError(r.error).join(" ")).toMatch(/máximo/i);
  });

  it("exige el cliente", () => {
    expect(enviarLinkDePagoSchema.safeParse({ amount: 1000 }).success).toBe(false);
  });

  it("deja los opcionales en nulo cuando vienen vacíos", () => {
    const r = enviarLinkDePagoSchema.safeParse({ customerId: "c1", amount: 1000, tenantId: "  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tenantId).toBeNull();
  });
});

describe("enviarMensajeSchema", () => {
  it("acepta un mensaje normal", () => {
    expect(enviarMensajeSchema.safeParse({ customerId: "c1", content: "Hola" }).success).toBe(true);
  });

  it("rechaza un mensaje vacío o de solo espacios", () => {
    expect(enviarMensajeSchema.safeParse({ customerId: "c1", content: "" }).success).toBe(false);
    expect(enviarMensajeSchema.safeParse({ customerId: "c1", content: "   " }).success).toBe(false);
  });

  it("corta en el límite de WhatsApp, donde se puede explicar", () => {
    const ok = enviarMensajeSchema.safeParse({ customerId: "c1", content: "x".repeat(MAX_MENSAJE) });
    const pasado = enviarMensajeSchema.safeParse({ customerId: "c1", content: "x".repeat(MAX_MENSAJE + 1) });
    expect(ok.success).toBe(true);
    expect(pasado.success).toBe(false);
  });
});

describe("detallesDeError", () => {
  it("dice qué campo falló, en vez de un invalid_payload mudo", () => {
    const r = enviarLinkDePagoSchema.safeParse({ amount: 0 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const detalles = detallesDeError(r.error);
      expect(detalles.some((d) => d.startsWith("customerId"))).toBe(true);
      expect(detalles.some((d) => d.startsWith("amount"))).toBe(true);
    }
  });
});

describe("reconciliarPagoSchema — el pago más importante de recuperar a mano", () => {
  it("acepta cualquiera de los cuatro identificadores", () => {
    for (const campo of ["paymentId", "reference", "wompiPaymentLinkId", "wompiTransactionId"]) {
      expect(reconciliarPagoSchema.safeParse({ [campo]: "x1" }).success, campo).toBe(true);
    }
  });

  it("rechaza un cuerpo sin ningún identificador antes de buscar en vano", () => {
    const r = reconciliarPagoSchema.safeParse({ tenantId: "t1" });
    expect(r.success).toBe(false);
    if (!r.success) expect(detallesDeError(r.error).join(" ")).toMatch(/al menos uno/i);
  });

  it("acepta los alias que la ruta ya admitía", () => {
    expect(reconciliarPagoSchema.safeParse({ paymentLinkId: "pl1" }).success).toBe(true);
    expect(reconciliarPagoSchema.safeParse({ transactionId: "tx1" }).success).toBe(true);
  });

  it("descarta un importe no positivo en vez de arrastrarlo", () => {
    const r = reconciliarPagoSchema.safeParse({ reference: "r1", amountInCents: -100 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amountInCents).toBeNull();
  });
});

describe("reconciliarPendientesSchema", () => {
  it("acepta valores razonables y los que llegan como texto por la query", () => {
    const r = reconciliarPendientesSchema.safeParse({ minutes: "60", take: "50" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.minutes).toBe(60);
      expect(r.data.take).toBe(50);
    }
  });

  it("rechaza un take sin techo, que recorría la tabla entera", () => {
    expect(reconciliarPendientesSchema.safeParse({ take: 100000 }).success).toBe(false);
  });

  it("rechaza una ventana absurda", () => {
    expect(reconciliarPendientesSchema.safeParse({ minutes: 0 }).success).toBe(false);
    expect(reconciliarPendientesSchema.safeParse({ minutes: 999999 }).success).toBe(false);
  });

  it("sin parámetros deja los valores por defecto del servicio", () => {
    const r = reconciliarPendientesSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.take).toBeNull();
  });
});
