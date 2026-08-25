import { BillingCycleStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/prisma";

/**
 * Repara ciclos de facturación marcados como SKIPPED que tienen vencimiento
 * futuro en suscripciones activas (ACTIVE, PAST_DUE). Estos ciclos no deberían
 * estar omitidos porque aún no ha llegado su fecha de cobro.
 *
 * Uso:
 *   npx tsx packages/core/src/scripts/repair-skipped-cycles.ts [--dry-run]
 */

const dryRun = process.argv.includes("--dry-run");

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE
];

async function main() {
  const now = new Date();
  console.log(dryRun ? "🔍 DRY RUN — no se escribirá nada\n" : "🔧 Reparando ciclos SKIPPED futuros...\n");

  const skippedCycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      status: BillingCycleStatus.SKIPPED,
      dueAt: { gt: now }
    },
    include: {
      subscription: {
        select: {
          id: true,
          status: true,
          canceledAt: true
        }
      }
    }
  });

  const anomalies = skippedCycles.filter((cycle) => {
    if (!ACTIVE_STATUSES.includes(cycle.subscription.status as SubscriptionStatus)) return false;
    if (cycle.subscription.canceledAt) return false;
    return true;
  });

  if (anomalies.length === 0) {
    console.log("✅ No se encontraron ciclos SKIPPED futuros en suscripciones activas.");
    return;
  }

  console.log(`Encontrados ${anomalies.length} ciclos SKIPPED anomalos:\n`);

  for (const cycle of anomalies) {
    const dueDate = cycle.dueAt.toISOString().split("T")[0];
    console.log(`  📅 Ciclo ${cycle.cycleNumber} — vence ${dueDate} — sub ${cycle.subscriptionId.slice(0, 8)} (${cycle.subscription.status})`);
  }

  if (!dryRun) {
    const result = await prisma.subscriptionBillingCycle.updateMany({
      where: {
        id: { in: anomalies.map((c) => c.id) }
      },
      data: {
        status: BillingCycleStatus.PENDING
      }
    });
    console.log(`\n✅ ${result.count} ciclos reseteados a PENDING.`);
  } else {
    console.log(`\n🔍 DRY RUN: se habrían reseteado ${anomalies.length} ciclos a PENDING.`);
  }
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
