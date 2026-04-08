/**
 * Script de reconciliación: corrige suscripciones marcadas como PAST_DUE
 * cuyo ciclo más reciente ya tiene un pago válido.
 *
 * REGLA: Si el ciclo más reciente tiene paymentId, la suscripción debe ser ACTIVE.
 */

import { prisma } from "../db/prisma";
import { SubscriptionStatus } from "@prisma/client";

async function main() {
  const pastDueSubs = await prisma.subscription.findMany({
    where: { status: SubscriptionStatus.PAST_DUE },
    select: { id: true, graceDays: true }
  });

  let recovered = 0;
  let stayedPastDue = 0;

  for (const sub of pastDueSubs) {
    const cycles = await prisma.subscriptionBillingCycle.findMany({
      where: { subscriptionId: sub.id },
      orderBy: [{ cycleNumber: "desc" }],
      take: 1,
      select: {
        paymentId: true,
        dueAt: true,
        status: true,
        cycleNumber: true
      }
    });
    const mostRecent = cycles[0] || null;

    if (mostRecent?.paymentId) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.ACTIVE }
      });
      console.log(`✅ Sub ${sub.id}: ciclo ${mostRecent.cycleNumber} pagado → ACTIVE`);
      recovered += 1;
    } else {
      stayedPastDue += 1;
    }
  }

  const result = {
    totalPastDueChecked: pastDueSubs.length,
    recoveredToActive: recovered,
    stayedPastDue
  };

  console.log("\n📊 Resultado:");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
