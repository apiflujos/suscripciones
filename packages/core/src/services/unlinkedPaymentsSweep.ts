import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { getExpectedSubscriptionTotalInCents } from "../lib/metadataSchemas";
import { namesLookRelated, samePhone } from "../lib/paymentNameMatch";
import { reconcileApprovedPaymentWithSubscription } from "./billingCycles";
import { associatePaymentToSubscription } from "./paymentAssociation";
import { systemLog } from "./systemLog";
import { LogLevel } from "@prisma/client";

const MAX_UNLINKED_SCANNED = 3000;
export const SWEEP_ACTOR = "system:auto-sweep";

export type UnlinkedSweepResult = {
  scanned: number;
  associated: number;
  /** Más de una suscripción posible, o ninguna con ese monto: no se adivina. */
  ambiguous: number;
  noMatch: number;
  /** Había suscripción, pero la fecha del pago no cae en ningún ciclo abierto. */
  outOfCycle: number;
  failed: number;
  subscriptionsUpdated: number;
};

type SweepSub = {
  id: string;
  customerId: string;
  currency: string;
  expectedInCents: number;
  email: string;
  phone: string | null;
  name: string | null;
};

/**
 * Asocia sola los pagos aprobados que llegaron sin suscripción.
 *
 * El webhook crea un contacto nuevo cuando el nombre o el correo del pagador no
 * coinciden con los del contacto ("Lina Cruz" frente a "Lina Marcela Cruz"): el
 * pago queda suelto y la suscripción real sigue en mora aunque el cliente pagó.
 *
 * Al ser automático es más estricto que la pantalla de asociar en lote. Un pago
 * se asocia solo si:
 *  - su monto es exactamente el cobro de la suscripción (y la moneda coincide),
 *  - el pagador es el mismo contacto, tiene el mismo correo o teléfono, o comparte
 *    dos palabras del nombre,
 *  - hay UNA sola suscripción activa que cumpla lo anterior (con dos no se adivina),
 *  - y su fecha cae en un ciclo abierto: de eso se encarga la asociación manual,
 *    que rechaza lo que no encaja.
 * Se procesa del pago más viejo al más nuevo para que cada uno ocupe el ciclo que le toca.
 */
export async function sweepUnlinkedPayments(args: { tenantId?: string | null; dryRun?: boolean } = {}): Promise<UnlinkedSweepResult> {
  const result: UnlinkedSweepResult = { scanned: 0, associated: 0, ambiguous: 0, noMatch: 0, outOfCycle: 0, failed: 0, subscriptionsUpdated: 0 };

  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "PAST_DUE"] }, ...(args.tenantId ? { tenantId: args.tenantId } : {}) },
    include: { customer: true, plan: true }
  });
  const subs: SweepSub[] = subscriptions
    .map((s: any) => ({
      id: s.id,
      customerId: s.customerId,
      currency: String(s.plan?.currency || "").trim().toUpperCase(),
      expectedInCents: getExpectedSubscriptionTotalInCents({
        subscriptionMetadata: s.metadata,
        planMetadata: s.plan?.metadata,
        fallback: s.plan?.priceInCents || 0
      }),
      email: String(s.customer?.email || "").trim().toLowerCase(),
      phone: s.customer?.phone ?? null,
      name: s.customer?.name ?? null
    }))
    .filter((s) => s.expectedInCents > 0);
  if (!subs.length) return result;

  const payments = await prisma.payment.findMany({
    where: {
      status: "APPROVED",
      subscriptionId: null,
      amountInCents: { gt: 0 },
      ...(args.tenantId ? { tenantId: args.tenantId } : {})
    },
    include: { customer: { select: { id: true, name: true, email: true, phone: true } } },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    take: MAX_UNLINKED_SCANNED
  });
  result.scanned = payments.length;

  const bySubscription = new Map<string, Array<(typeof payments)[number]>>();
  for (const payment of payments) {
    const c = payment.customer;
    const email = String(c?.email || "").trim().toLowerCase();
    const currency = String(payment.currency || "").trim().toUpperCase();
    const candidates = subs.filter((s) => {
      if (s.expectedInCents !== payment.amountInCents) return false;
      if (currency && s.currency && currency !== s.currency) return false;
      return (
        (c?.id && c.id === s.customerId) ||
        (email && email === s.email) ||
        samePhone(c?.phone, s.phone) ||
        namesLookRelated(c?.name, s.name)
      );
    });
    if (candidates.length === 0) {
      result.noMatch += 1;
      continue;
    }
    if (candidates.length > 1) {
      result.ambiguous += 1;
      continue;
    }
    const list = bySubscription.get(candidates[0].id) ?? [];
    list.push(payment);
    bySubscription.set(candidates[0].id, list);
  }

  for (const [subscriptionId, list] of bySubscription) {
    let lastOk: (typeof payments)[number] | null = null;
    for (const payment of list) {
      if (args.dryRun) {
        result.associated += 1;
        continue;
      }
      const res: { ok: boolean; error?: string } = await associatePaymentToSubscription({
        paymentId: payment.id,
        subscriptionId,
        actorEmail: SWEEP_ACTOR
      }).catch((err: any) => {
        logger.warn({ err, paymentId: payment.id, subscriptionId }, "[Sweep] Fallo asociando un pago suelto");
        return { ok: false, error: "exception" };
      });
      if (res.ok) {
        result.associated += 1;
        lastOk = payment;
      } else if (res.error === "out_of_cycle") {
        result.outOfCycle += 1;
      } else {
        result.failed += 1;
      }
    }
    // La asociación de un pago no recalcula el estado: sin esto la suscripción
    // seguiría en mora aunque ya no le quede ningún ciclo vencido.
    if (lastOk) {
      result.subscriptionsUpdated += 1;
      await reconcileApprovedPaymentWithSubscription({
        subscriptionId,
        paymentId: lastOk.id,
        paymentAt: lastOk.paidAt || lastOk.createdAt,
        asOf: new Date()
      }).catch((err) => logger.warn({ err, subscriptionId }, "[Sweep] Fallo refrescando el estado de la suscripción"));
    }
  }

  if (!args.dryRun && result.associated > 0) {
    await systemLog(LogLevel.INFO, "payments.sweep", "Pagos sueltos asociados automáticamente", { ...result }, "Sistema").catch(() => null);
  }
  return result;
}
