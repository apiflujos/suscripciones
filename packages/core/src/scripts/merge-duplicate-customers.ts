import { prisma } from "../db/prisma";
import { normalizePhoneE164 } from "../lib/phone";

/**
 * Encuentra clientes con teléfonos duplicados y los fusiona.
 * Para cada par de duplicados, conserva el cliente con más actividad
 * (suscripciones + pagos) y mueve todo al sobreviviente.
 *
 * Uso:
 *   npx tsx packages/core/src/scripts/merge-duplicate-customers.ts [--dry-run]
 */

const dryRun = process.argv.includes("--dry-run");

type CustomerWithStats = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  subscriptionCount: number;
  paymentCount: number;
  createdAt: Date;
};

async function findDuplicatePhones(): Promise<Map<string, CustomerWithStats[]>> {
  const customers = await prisma.customer.findMany({
    where: { phone: { not: null } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      _count: {
        select: {
          subscriptions: true,
          payments: true
        }
      }
    }
  });

  const byPhone = new Map<string, CustomerWithStats[]>();
  for (const c of customers) {
    const normalized = normalizePhoneE164(c.phone);
    if (!normalized) continue;
    const stats: CustomerWithStats = {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: normalized,
      subscriptionCount: c._count.subscriptions,
      paymentCount: c._count.payments,
      createdAt: c.createdAt
    };
    const list = byPhone.get(normalized) ?? [];
    list.push(stats);
    byPhone.set(normalized, list);
  }

  const duplicates = new Map<string, CustomerWithStats[]>();
  for (const [phone, list] of byPhone) {
    if (list.length > 1) duplicates.set(phone, list);
  }
  return duplicates;
}

function pickSurvivor(customers: CustomerWithStats[]): { keep: CustomerWithStats; merge: CustomerWithStats[] } {
  const sorted = [...customers].sort((a, b) => {
    const activityA = a.subscriptionCount + a.paymentCount;
    const activityB = b.subscriptionCount + b.paymentCount;
    if (activityB !== activityA) return activityB - activityA;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return { keep: sorted[0], merge: sorted.slice(1) };
}

async function mergeCustomer(keepId: string, mergeId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { customerId: mergeId },
      data: { customerId: keepId }
    });
    await tx.payment.updateMany({
      where: { customerId: mergeId },
      data: { customerId: keepId }
    });
    await tx.paymentAttempt.updateMany({
      where: { payment: { customerId: mergeId } } as any,
      data: {}
    });
    await tx.chatwootMessage.updateMany({
      where: { customerId: mergeId },
      data: { customerId: keepId }
    });
    await tx.customerTenant.updateMany({
      where: { customerId: mergeId },
      data: { customerId: keepId }
    });
    await tx.retryJob.updateMany({
      where: { payload: { path: ["customerId"], equals: mergeId } as any },
      data: { payload: { set: { customerId: keepId } } as any }
    }).catch(() => {});
    await tx.customer.delete({ where: { id: mergeId } });
  });
}

async function main() {
  console.log(dryRun ? "🔍 DRY RUN — no se escribirá nada\n" : "🔧 Fusionando clientes duplicados...\n");

  const duplicates = await findDuplicatePhones();
  if (duplicates.size === 0) {
    console.log("✅ No se encontraron teléfonos duplicados.");
    return;
  }

  console.log(`Encontrados ${duplicates.size} teléfonos con duplicados:\n`);

  let mergedCount = 0;
  for (const [phone, customers] of duplicates) {
    const { keep, merge } = pickSurvivor(customers);
    console.log(`📱 ${phone}`);
    console.log(`   Conservar: ${keep.name ?? "(sin nombre)"} (${keep.id.slice(0, 8)}) — ${keep.subscriptionCount} subs, ${keep.paymentCount} pagos`);
    for (const m of merge) {
      console.log(`   Fusionar:  ${m.name ?? "(sin nombre)"} (${m.id.slice(0, 8)}) — ${m.subscriptionCount} subs, ${m.paymentCount} pagos`);
    }

    if (!dryRun) {
      for (const m of merge) {
        await mergeCustomer(keep.id, m.id);
        mergedCount++;
      }
    } else {
      mergedCount += merge.length;
    }
    console.log("");
  }

  console.log(dryRun
    ? `🔍 DRY RUN: se habrían fusionado ${mergedCount} clientes.`
    : `✅ Fusionados ${mergedCount} clientes duplicados.`
  );
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
