import { prisma } from "../db/prisma";

async function main() {
  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      metadata: { path: ["catalog", "itemId"], not: null } as any
    },
    select: { id: true, name: true, metadata: true }
  });

  let scanned = 0;
  let fixed = 0;
  for (const plan of plans) {
    scanned += 1;
    const meta = plan.metadata && typeof plan.metadata === "object" ? (plan.metadata as any) : {};
    const catalog = meta?.catalog && typeof meta.catalog === "object" ? meta.catalog : {};
    const itemId = String(catalog?.itemId || "").trim();
    if (!itemId) continue;

    const item = await prisma.subscriptionPlan.findFirst({
      where: { id: itemId, metadata: { path: ["kind"], equals: "CATALOG_ITEM" } as any },
      select: { id: true }
    });
    if (item) continue;

    const nextCatalog = { ...catalog };
    delete nextCatalog.itemId;
    nextCatalog.orphanedItemId = itemId;
    nextCatalog.orphanedAt = new Date().toISOString();

    const nextMeta = {
      ...meta,
      catalog: nextCatalog
    };

    await prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { metadata: nextMeta as any }
    });
    fixed += 1;
    console.log(`Fixed orphan catalog ref in plan ${plan.id} (${plan.name}) -> ${itemId}`);
  }

  console.log(`Done. Scanned: ${scanned}. Fixed: ${fixed}.`);
}

main()
  .catch((err) => {
    console.error("repair failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

