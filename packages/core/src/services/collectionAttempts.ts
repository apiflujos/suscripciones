import { prisma } from "../db/prisma";

/**
 * Cuántas veces se le intentó cobrar a un ciclo.
 *
 * Cuenta los cobros reales contra la tarjeta, no los reintentos del job: un
 * cobro declinado no lanza error —Wompi responde por webhook—, así que el job
 * termina bien y su contador de intentos nunca sube. Sin esto, cada pasada del
 * sincronizador vuelve a cobrar el mismo ciclo indefinidamente.
 */
export async function countCycleChargeAttempts(args: {
  subscriptionId: string;
  cycleNumber: number | null | undefined;
}): Promise<number> {
  const subscriptionId = String(args.subscriptionId || "").trim();
  // Ojo con null: Number(null) es 0 y se colaba como ciclo válido, con lo que
  // la consulta no encontraba nada y el tope quedaba sin efecto.
  if (!subscriptionId || args.cycleNumber == null) return 0;
  const cycleNumber = Number(args.cycleNumber);
  if (!Number.isFinite(cycleNumber)) return 0;

  const payments = await prisma.payment.findMany({
    where: { subscriptionId, cycleNumber },
    select: { id: true }
  });
  if (!payments.length) return 0;

  // Un cobro puede reusar la misma fila de Payment y anotar cada intento en
  // PaymentAttempt, así que el número real es el mayor de los dos.
  const attempts = await prisma.paymentAttempt.count({
    where: { paymentId: { in: payments.map((p) => p.id) } }
  });
  return Math.max(payments.length, attempts);
}

/** Cuántos cobros se permiten por ciclo: el original más los reintentos. */
export function maxAttemptsPerCycle(config: { retryEnabled?: boolean | null; maxRetries?: number | null }) {
  if (!config?.retryEnabled) return 1;
  const retries = Number.isFinite(Number(config?.maxRetries)) ? Math.max(0, Math.trunc(Number(config.maxRetries))) : 0;
  return 1 + retries;
}

/**
 * Si el ciclo ya agotó sus intentos, nadie debe volver a pasar la tarjeta:
 * insistir sobre una tarjeta que rechaza es lo que hace que el adquirente
 * marque al comercio.
 */
export async function hasExhaustedCycleAttempts(args: {
  subscriptionId: string;
  cycleNumber: number | null | undefined;
  config: { retryEnabled?: boolean | null; maxRetries?: number | null };
}): Promise<{ exhausted: boolean; attempts: number; allowed: number }> {
  const allowed = maxAttemptsPerCycle(args.config);
  const attempts = await countCycleChargeAttempts({
    subscriptionId: args.subscriptionId,
    cycleNumber: args.cycleNumber
  });
  return { exhausted: attempts >= allowed, attempts, allowed };
}
