import { prisma } from "../db/prisma";

/**
 * Siguiente referencia libre para reintentar un cobro del mismo ciclo.
 *
 * Wompi no acepta repetir una referencia. Antes el sufijo salía de CONTAR los pagos
 * (o intentos) del ciclo, así que bastaba con que un pago dejara de contar para ese
 * ciclo —uno desvinculado, movido o reasignado— para que el conteo reiniciara y se
 * volviera a generar una referencia ya usada: el cobro fallaba con "referencia ya
 * usada" y había que insistir hasta pasar el último sufijo. Ahora se toma el mayor
 * sufijo _R<n> que exista en cualquier pago o intento con esa base, sin importar a
 * qué ciclo apunten hoy, y se le suma uno.
 */
export async function nextRetryReference(reference: string): Promise<string> {
  const base = String(reference || "").replace(/(_R\d+)+$/, "");
  const matcher = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:_R(\\d+))*$`);
  const [payments, attempts] = await Promise.all([
    prisma.payment.findMany({ where: { reference: { startsWith: base } }, select: { reference: true } }),
    prisma.paymentAttempt.findMany({ where: { reference: { startsWith: base } }, select: { reference: true } })
  ]);
  let highest = 0;
  for (const row of [...payments, ...attempts]) {
    const ref = String(row.reference || "");
    if (!matcher.test(ref)) continue;
    for (const m of ref.matchAll(/_R(\d+)/g)) highest = Math.max(highest, Number(m[1]));
  }
  return `${base}_R${highest + 1}`;
}
