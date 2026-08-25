import { BillingCycleStatus } from "@prisma/client";
import { prisma } from "../db/prisma";

/**
 * Repara ciclos de facturación marcados como PAID que no tienen paymentId.
 * Estos ciclos se resetean a PENDING para que el constraint de la base de datos
 * no falle al aplicarse.
 *
 * Uso:
 *   npx tsx packages/core/src/scripts/repair-paid-cycles-without-payment.ts [--dry-run]
 */

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(dryRun ? "🔍 DRY RUN — no se escribirá nada\n" : "🔧 Reparando ciclos PAID sin pago...\n");

  const orphanPaidCycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      status: BillingCycleStatus.PAID,
      paymentId: null
    },
    select: {
      id: true,
      cycleNumber: true,
      dueAt: true,
      subscriptionId: true
    }
  });

  if (orphanPaidCycles.length === 0) {
    console.log("✅ No se encontraron ciclos PAID sin paymentId.");
    return;
  }

  console.log(`Encontrados ${orphanPaidCycles.length} ciclos PAID sin pago:\n`);

  for (const cycle of orphanPaidCycles.slice(0, 10)) {
    const dueDate = cycle.dueAt.toISOString().split("T")[0];
    console.log(`  📅 Ciclo ${cycle.cycleNumber} — vence ${dueDate} — sub ${cycle.subscriptionId.slice(0, 8)}`);
  }
  if (orphanPaidCycles.length > 10) {
    console.log(`  ... y ${orphanPaidCycles.length - 10} más`);
  }

  if (!dryRun) {
    const result = await prisma.subscriptionBillingCycle.updateMany({
      where: {
        id: { in: orphanPaidCycles.map((c) => c.id) }
      },
      data: {
        status: BillingCycleStatus.PENDING
      }
    });
    console.log(`\n✅ ${result.count} ciclos reseteados a PENDING.`);
    console.log("   Ahora puedes aplicar la migración con el constraint CHECK.");
  } else {
    console.log(`\n🔍 DRY RUN: se habrían reseteado ${orphanPaidCycles.length} ciclos a PENDING.`);
  }
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
