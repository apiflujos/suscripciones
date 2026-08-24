"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOUBLE_CHARGE_WINDOW_MS = void 0;
exports.countCycleChargeAttempts = countCycleChargeAttempts;
exports.maxAttemptsPerCycle = maxAttemptsPerCycle;
exports.hasExhaustedCycleAttempts = hasExhaustedCycleAttempts;
exports.hasRecentChargeAttempt = hasRecentChargeAttempt;
const prisma_1 = require("../db/prisma");
/**
 * Cuántas veces se le intentó cobrar a un ciclo.
 *
 * Cuenta los cobros reales contra la tarjeta, no los reintentos del job: un
 * cobro declinado no lanza error —Wompi responde por webhook—, así que el job
 * termina bien y su contador de intentos nunca sube. Sin esto, cada pasada del
 * sincronizador vuelve a cobrar el mismo ciclo indefinidamente.
 */
async function countCycleChargeAttempts(args) {
    const subscriptionId = String(args.subscriptionId || "").trim();
    // Ojo con null: Number(null) es 0 y se colaba como ciclo válido, con lo que
    // la consulta no encontraba nada y el tope quedaba sin efecto.
    if (!subscriptionId || args.cycleNumber == null)
        return 0;
    const cycleNumber = Number(args.cycleNumber);
    if (!Number.isFinite(cycleNumber))
        return 0;
    const payments = await prisma_1.prisma.payment.findMany({
        where: { subscriptionId, cycleNumber },
        select: { id: true }
    });
    if (!payments.length)
        return 0;
    // Un cobro puede reusar la misma fila de Payment y anotar cada intento en
    // PaymentAttempt, así que el número real es el mayor de los dos.
    const attempts = await prisma_1.prisma.paymentAttempt.count({
        where: { paymentId: { in: payments.map((p) => p.id) } }
    });
    return Math.max(payments.length, attempts);
}
/** Cuántos cobros se permiten por ciclo: el original más los reintentos. */
function maxAttemptsPerCycle(config) {
    if (!config?.retryEnabled)
        return 1;
    const retries = Number.isFinite(Number(config?.maxRetries)) ? Math.max(0, Math.trunc(Number(config.maxRetries))) : 0;
    return 1 + retries;
}
/**
 * Si el ciclo ya agotó sus intentos, nadie debe volver a pasar la tarjeta:
 * insistir sobre una tarjeta que rechaza es lo que hace que el adquirente
 * marque al comercio.
 */
async function hasExhaustedCycleAttempts(args) {
    const allowed = maxAttemptsPerCycle(args.config);
    const attempts = await countCycleChargeAttempts({
        subscriptionId: args.subscriptionId,
        cycleNumber: args.cycleNumber
    });
    return { exhausted: attempts >= allowed, attempts, allowed };
}
/** Ventana en la que un segundo cobro es, casi siempre, el mismo clic dos veces. */
exports.DOUBLE_CHARGE_WINDOW_MS = 60_000;
/**
 * ¿Se le acaba de pasar la tarjeta a esta suscripción?
 *
 * El guard que ya existía solo miraba cobros PENDING, así que un cobro
 * declinado hace segundos no frenaba al siguiente: dos clics seguidos —o dos
 * pestañas— llegaban los dos a la tarjeta.
 */
async function hasRecentChargeAttempt(args) {
    const subscriptionId = String(args.subscriptionId || "").trim();
    if (!subscriptionId)
        return { recent: false, at: null };
    const withinMs = Number.isFinite(Number(args.withinMs)) ? Math.max(0, Number(args.withinMs)) : exports.DOUBLE_CHARGE_WINDOW_MS;
    if (!withinMs)
        return { recent: false, at: null };
    const since = new Date(Date.now() - withinMs);
    const attempt = await prisma_1.prisma.paymentAttempt.findFirst({
        where: { createdAt: { gte: since }, payment: { subscriptionId } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
    });
    if (attempt)
        return { recent: true, at: attempt.createdAt };
    // Un cobro puede haber quedado registrado sin fila de intento.
    const payment = await prisma_1.prisma.payment.findFirst({
        where: { subscriptionId, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
    });
    return { recent: Boolean(payment), at: payment?.createdAt ?? null };
}
