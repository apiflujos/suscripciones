import { BillingCycleStatus, PaymentAssociationReason, PaymentStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { resolveAssociationByScore } from "../jobs/handlers/processWompiEvent";
import {
  getCustomerEmailFromPayload,
  getCustomerNameFromPayload,
  getCustomerPhoneFromPayload
} from "../jobs/handlers/processWompiEvent/parseWebhookFields";
import { reconcileApprovedPaymentWithSubscription } from "../services/billingCycles";
import { classifyReference } from "../webhooks/wompi/classifyReference";

/**
 * Vuelve a intentar asociar a una suscripción los pagos APROBADOS que llegaron
 * por webhook y quedaron sin suscripción (los "Pago por link de pago" con "—").
 * Usa el mismo asociador que el webhook, así que aplica las mismas garantías:
 * monto exacto o única suscripción activa, y nada de adivinar entre homónimos.
 *
 * Por defecto NO escribe: solo imprime lo que haría. Los pagos que no se pueden
 * asociar con seguridad se listan aparte para asociarlos a mano desde Logs.
 *
 * Uso:
 *   npx tsx packages/core/src/scripts/repair-unlinked-payments.ts [--days=45] [--apply]
 */

const apply = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const days = Math.max(1, Number(daysArg?.split("=")[1]) || 45);

function webhookPayloadOf(providerResponse: unknown) {
  if (!providerResponse || typeof providerResponse !== "object") return null;
  const webhook = (providerResponse as Record<string, unknown>).webhook;
  return webhook && typeof webhook === "object" ? (webhook as any) : null;
}

async function main() {
  console.log(apply ? "🔧 Asociando pagos huérfanos...\n" : "🔍 DRY RUN — no se escribirá nada (usa --apply para aplicar)\n");

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const payments = await prisma.payment.findMany({
    where: { status: PaymentStatus.APPROVED, subscriptionId: null, createdAt: { gte: since } },
    // Del más viejo al más nuevo: cada pago ocupa el ciclo impago más antiguo y
    // el siguiente cae en el que sigue.
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }]
  });
  console.log(`Pagos aprobados sin suscripción (últimos ${days} días): ${payments.length}\n`);

  let associated = 0;
  const pending: string[] = [];

  for (const p of payments) {
    const payload = webhookPayloadOf(p.providerResponse);
    const label = `${p.id.slice(0, 8)} · ${(p.amountInCents / 100).toLocaleString("es-CO")} ${p.currency} · ${p.paidAt?.toISOString().slice(0, 10) ?? "s/f"}`;
    if (!payload) {
      pending.push(`${label} — sin datos del webhook`);
      continue;
    }
    const decision = await resolveAssociationByScore({
      db: prisma,
      tenantId: p.tenantId,
      amountInCents: p.amountInCents,
      currency: p.currency,
      paymentMatched: null,
      paymentLinkRecord: null,
      referenceClassification: classifyReference(p.reference),
      email: getCustomerEmailFromPayload(payload),
      phone: getCustomerPhoneFromPayload(payload),
      name: getCustomerNameFromPayload(payload)
    }).catch((err) => {
      console.warn(`  ⚠️  ${label}: falló el asociador (${err?.message || err})`);
      return null;
    });

    if (!decision?.subscriptionId) {
      pending.push(
        `${label} — ${getCustomerNameFromPayload(payload) || "sin nombre"} · ${getCustomerEmailFromPayload(payload) || "sin email"} · ${getCustomerPhoneFromPayload(payload) || "sin teléfono"}`
      );
      continue;
    }

    const cycle = decision.cycleNumber
      ? await prisma.subscriptionBillingCycle.findUnique({
          where: { subscriptionId_cycleNumber: { subscriptionId: decision.subscriptionId, cycleNumber: decision.cycleNumber } }
        })
      : await prisma.subscriptionBillingCycle.findFirst({
          where: { subscriptionId: decision.subscriptionId, paymentId: null, status: { not: BillingCycleStatus.PAID } },
          orderBy: [{ dueAt: "asc" }, { cycleNumber: "asc" }]
        });
    if (!cycle) {
      pending.push(`${label} — suscripción ${decision.subscriptionId.slice(0, 8)} sin ciclo impago para atar`);
      continue;
    }

    console.log(
      `  ✅ ${label} → sub ${decision.subscriptionId.slice(0, 8)} ciclo #${cycle.cycleNumber} (score ${decision.score}, ${JSON.stringify(decision.criteria)})`
    );
    associated += 1;
    if (!apply) continue;

    await prisma.payment.update({
      where: { id: p.id },
      data: {
        subscriptionId: decision.subscriptionId,
        customerId: decision.customerId ?? p.customerId,
        associationReason: PaymentAssociationReason.IDENTITY_MATCH,
        associatedBy: "repair:unlinked-payments",
        matchScore: decision.score,
        matchCriteria: decision.criteria as any
      }
    });
    await reconcileApprovedPaymentWithSubscription({
      subscriptionId: decision.subscriptionId,
      paymentId: p.id,
      paymentAt: p.paidAt ?? p.createdAt,
      cycleId: cycle.id,
      origin: p.origin,
      associationReason: PaymentAssociationReason.IDENTITY_MATCH,
      associatedBy: "repair:unlinked-payments"
    });
  }

  console.log(`\n${apply ? "Asociados" : "Se asociarían"}: ${associated} de ${payments.length}`);
  if (pending.length) {
    console.log(`\nSin asociar (revisar a mano desde Logs): ${pending.length}`);
    for (const line of pending) console.log(`  • ${line}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
