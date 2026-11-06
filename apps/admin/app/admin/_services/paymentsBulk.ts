import "server-only";

import { prisma } from "@suscripciones/database";
import { findBestBillingCycleForPayment } from "@suscripciones/core/services/billingCycles";
import { getExpectedSubscriptionTotalInCents } from "@suscripciones/core/lib/metadataSchemas";
import { matchesQuery, namesLookRelated, samePhone } from "./paymentNameMatch";

/** La misma holgura que usa la asociación manual al validar el ciclo. */
const TOLERANCE_DAYS = 7;
const TOLERANCE_MS = TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
const MAX_UNLINKED_SCANNED = 3000;

export type BulkCandidate = {
  paymentId: string;
  contactName: string;
  contactEmail: string | null;
  paidAt: string | null;
  amountInCents: number;
  currency: string;
  reference: string;
  /** Por qué se propone: mismo contacto, nombre parecido, mismo teléfono o email, o búsqueda. */
  reason: "same_contact" | "similar_name" | "same_phone" | "same_email" | "search";
  /** Ciclo al que caería hoy, del más viejo al más nuevo; null si ninguno encaja por fecha. */
  cycleNumber: number | null;
  cycleDueAt: string | null;
  amountMatches: boolean;
};

export type BulkCandidates = {
  subscriptionId: string;
  contactName: string;
  expectedInCents: number;
  currency: string;
  openCycles: number;
  items: BulkCandidate[];
};

/**
 * Pagos aprobados que llegaron sin suscripción y pueden ser de esta.
 *
 * El webhook crea un contacto nuevo cuando el nombre o el correo del pagador no
 * coinciden con los del contacto ("Lina Cruz" frente a "Lina Marcela Cruz"), y el
 * pago queda suelto mientras la suscripción real sigue en mora. Aquí se juntan
 * esos pagos y se simula a qué ciclo caería cada uno, del más viejo al más nuevo,
 * con la misma regla de fechas que aplica la asociación manual.
 */
export async function listBulkAssociationCandidates(args: { subscriptionId: string; q?: string }): Promise<BulkCandidates | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: args.subscriptionId },
    include: { customer: true, plan: true }
  });
  if (!subscription) return null;

  const q = String(args.q || "").trim();
  const customer = subscription.customer;
  const expectedInCents = getExpectedSubscriptionTotalInCents({
    subscriptionMetadata: subscription.metadata,
    planMetadata: (subscription.plan as any)?.metadata,
    fallback: (subscription.plan as any)?.priceInCents || 0
  });

  const [unlinked, openCycles] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: "APPROVED",
        subscriptionId: null,
        ...(subscription.tenantId ? { tenantId: subscription.tenantId } : {})
      },
      include: { customer: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
      take: MAX_UNLINKED_SCANNED
    }),
    prisma.subscriptionBillingCycle.findMany({
      where: { subscriptionId: subscription.id, paymentId: null, status: { not: "PAID" } },
      orderBy: [{ dueAt: "asc" }, { cycleNumber: "asc" }]
    })
  ]);

  const email = String(customer?.email || "").trim().toLowerCase();
  const picked: Array<{ payment: (typeof unlinked)[number]; reason: BulkCandidate["reason"] }> = [];
  for (const payment of unlinked) {
    const c = payment.customer;
    let reason: BulkCandidate["reason"] | null = null;
    if (c?.id && c.id === subscription.customerId) reason = "same_contact";
    else if (email && String(c?.email || "").trim().toLowerCase() === email) reason = "same_email";
    else if (samePhone(c?.phone, customer?.phone)) reason = "same_phone";
    else if (namesLookRelated(c?.name, customer?.name)) reason = "similar_name";
    else if (q && matchesQuery([c?.name, c?.email, c?.phone].join(" "), q)) reason = "search";
    if (reason) picked.push({ payment, reason });
  }

  // Del más viejo al más nuevo: cada pago ocupa el ciclo que le toca y el siguiente
  // cae en el que sigue, igual que cuando se asocian de uno en uno.
  const remaining = [...openCycles];
  const items: BulkCandidate[] = picked.map(({ payment, reason }) => {
    const paymentAt = payment.paidAt || payment.createdAt;
    let cycle = remaining.length ? findBestBillingCycleForPayment({ cycles: remaining as any, paymentAt, toleranceDays: TOLERANCE_DAYS }) : null;
    if (cycle) {
      const fits =
        paymentAt.getTime() >= new Date(cycle.periodStartAt).getTime() - TOLERANCE_MS &&
        paymentAt.getTime() <= new Date(cycle.periodEndAt).getTime() + TOLERANCE_MS;
      if (!fits) cycle = null;
    }
    if (cycle) remaining.splice(remaining.findIndex((c) => c.id === (cycle as any).id), 1);
    return {
      paymentId: payment.id,
      contactName: String(payment.customer?.name || "—"),
      contactEmail: payment.customer?.email ?? null,
      paidAt: paymentAt ? paymentAt.toISOString() : null,
      amountInCents: payment.amountInCents,
      currency: payment.currency,
      reference: payment.reference,
      reason,
      cycleNumber: cycle ? (cycle as any).cycleNumber : null,
      cycleDueAt: cycle ? new Date((cycle as any).dueAt).toISOString() : null,
      amountMatches: expectedInCents > 0 && payment.amountInCents === expectedInCents
    };
  });

  return {
    subscriptionId: subscription.id,
    contactName: String(customer?.name || ""),
    expectedInCents,
    currency: String((subscription.plan as any)?.currency || "COP"),
    openCycles: openCycles.length,
    items
  };
}
