import { z } from "zod";

/**
 * Esquemas de cuerpo para las rutas que no tenían ninguno.
 *
 * El criterio es NO romper nada: cada esquema acepta exactamente lo que la ruta
 * aceptaba antes —las rutas hacían `String(body?.x || "").trim()`, así que un
 * número entraba igual que una cadena— y solo rechaza lo que ya era inválido o
 * lo que no tenía por qué llegar tan grande.
 */

/** Texto que la ruta habría coercionado con String(). Vacío = ausente. */
export const textoOpcional = z
  .union([z.string(), z.number(), z.boolean()])
  .optional()
  .nullable()
  .transform((v) => (v == null ? null : String(v).trim() || null));

/** Igual, pero obligatorio. */
export const textoRequerido = (campo: string, max = 200) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => v.length > 0, `${campo} requerido`)
    .refine((v) => v.length <= max, `${campo} excede ${max} caracteres`);

/**
 * Importe en pesos.
 *
 * La ruta solo comprobaba que fuera mayor que cero. Sin techo, un valor absurdo
 * generaba un link de cobro por ese importe: el tope no está para prevenir un
 * ataque sofisticado sino un cero de más al teclear.
 */
export const MAX_PESOS = 100_000_000;
export const importeEnPesos = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const digitos = String(v ?? "").replace(/[^\d-]/g, "");
    if (!digitos) return Number.NaN;
    const pesos = Number(digitos);
    return Number.isFinite(pesos) ? Math.trunc(pesos) : Number.NaN;
  })
  .refine((n) => Number.isFinite(n), "El importe no es un número")
  .refine((n) => n > 0, "El importe debe ser mayor que cero")
  .refine((n) => n <= MAX_PESOS, `El importe supera el máximo de ${MAX_PESOS.toLocaleString("es-CO")} COP`);

/**
 * Contenido de un mensaje que recibe un cliente por WhatsApp.
 *
 * WhatsApp corta el cuerpo en 4096 caracteres; mandar más solo produce un
 * mensaje truncado y un fallo de envío que se reintenta. Se corta aquí, donde se
 * puede explicar, y no en Meta.
 */
export const MAX_MENSAJE = 4096;
export const contenidoMensaje = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => v.trim().length > 0, "El mensaje está vacío")
  .refine((v) => v.length <= MAX_MENSAJE, `El mensaje supera los ${MAX_MENSAJE} caracteres`);

export const enviarMensajeSchema = z.object({
  customerId: textoRequerido("customerId", 64),
  content: contenidoMensaje
});

export const enviarLinkDePagoSchema = z.object({
  customerId: textoRequerido("customerId", 64),
  amount: importeEnPesos,
  customerName: textoOpcional,
  tenantId: textoOpcional,
  productId: textoOpcional
});

/**
 * Publicación en un canal de tiempo real.
 *
 * ⛔ La lista de permisos FALLABA ABIERTA. `CHANNEL_PERMS[channel] || []` devuelve
 * un array vacío para cualquier canal que no esté en el mapa, y el chequeo
 * `required.length && ...` se saltaba entero: los cuatro canales conocidos
 * estaban protegidos y cualquier otro nombre pasaba sin permiso alguno. Una lista
 * blanca que autoriza todo lo que no está en ella no es una lista blanca.
 *
 * Ahora el canal tiene que ser uno de los declarados.
 */
export const CANALES_TIEMPO_REAL = ["notifications", "payments", "logs", "jobs"] as const;
export type CanalTiempoReal = (typeof CANALES_TIEMPO_REAL)[number];

/** Un payload se difunde a todos los suscriptores: conviene que no sea enorme. */
export const MAX_PAYLOAD_BYTES = 32 * 1024;

export const publicarTiempoRealSchema = z.object({
  channel: z.enum(CANALES_TIEMPO_REAL, {
    errorMap: () => ({ message: `channel debe ser uno de: ${CANALES_TIEMPO_REAL.join(", ")}` })
  }),
  payload: z
    .unknown()
    .optional()
    .transform((v) => v ?? {})
    .refine((v) => {
      try {
        return JSON.stringify(v).length <= MAX_PAYLOAD_BYTES;
      } catch {
        // Referencias circulares: no se puede difundir lo que no se serializa.
        return false;
      }
    }, `El payload supera ${MAX_PAYLOAD_BYTES} bytes o no es serializable`)
});

/** Detalle legible de por qué se rechazó, en vez de un "invalid_payload" mudo. */
export function detallesDeError(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

/**
 * Reconciliación manual de un pago.
 *
 * Se identifica por cualquiera de cuatro campos; al menos uno tiene que venir, o
 * el servicio busca con todos vacíos y no encuentra nada. Antes ese caso llegaba
 * hasta el fondo y volvía como "missing_reconcile_identifiers"; ahora se corta
 * en la puerta y se dice cuáles valen.
 */
export const reconciliarPagoSchema = z
  .object({
    paymentId: textoOpcional,
    reference: textoOpcional,
    wompiPaymentLinkId: textoOpcional,
    paymentLinkId: textoOpcional,
    wompiTransactionId: textoOpcional,
    transactionId: textoOpcional,
    tenantId: textoOpcional,
    amountInCents: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => {
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
      }),
    amount_in_cents: z.union([z.string(), z.number()]).optional().nullable(),
    currency: textoOpcional
  })
  .refine(
    (d) =>
      Boolean(d.paymentId || d.reference || d.wompiPaymentLinkId || d.paymentLinkId || d.wompiTransactionId || d.transactionId),
    {
      message:
        "Hace falta al menos uno: paymentId, reference, wompiPaymentLinkId o wompiTransactionId."
    }
  );

/**
 * Reconciliación de los pagos pendientes de una ventana.
 *
 * `take` sin techo recorría la tabla entera en una sola petición. Los límites
 * son los que el propio servicio ya aplicaba por dentro; declararlos aquí los
 * hace visibles y devuelve un error explicable en vez de un recorte silencioso.
 */
export const reconciliarPendientesSchema = z.object({
  minutes: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v == null || v === "" ? null : Number(v)))
    .refine((v) => v == null || (Number.isFinite(v) && v > 0 && v <= 60 * 24 * 30), "minutes fuera de rango (1 a 43200)"),
  take: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v == null || v === "" ? null : Number(v)))
    .refine((v) => v == null || (Number.isFinite(v) && v > 0 && v <= 1000), "take fuera de rango (1 a 1000)"),
  tenantId: textoOpcional
});
