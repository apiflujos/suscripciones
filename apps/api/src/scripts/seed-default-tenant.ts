import { prisma } from "../db/prisma";

function normalize(v: unknown) {
  return String(v || "").trim();
}

async function main() {
  const name =
    normalize(process.env.SA_DEFAULT_TENANT_NAME) ||
    normalize(process.env.DEFAULT_TENANT_NAME) ||
    "Mercado de vinos";

  if (!name) {
    console.log("seed-default-tenant: missing tenant name, skipping");
    return;
  }

  let tenant = await prisma.saTenant.findFirst({
    where: { name: { equals: name, mode: "insensitive" } }
  });

  if (!tenant) {
    tenant = await prisma.saTenant.create({ data: { name, active: true } });
    console.log("seed-default-tenant: created", { id: tenant.id, name: tenant.name });
  } else {
    console.log("seed-default-tenant: found", { id: tenant.id, name: tenant.name });
  }

  const updatedNull = await prisma.saUser.updateMany({
    where: { tenantId: null },
    data: { tenantId: tenant.id }
  });

  const superAdminEmail = normalize(process.env.SUPER_ADMIN_EMAIL).toLowerCase();
  if (superAdminEmail) {
    await prisma.saUser.updateMany({
      where: { email: { equals: superAdminEmail, mode: "insensitive" } },
      data: { tenantId: tenant.id }
    });
  }

  const backfills = await Promise.all([
    prisma.customer.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.subscriptionPlan.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.publicCheckoutTemplate.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.subscription.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.payment.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.paymentLink.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.webhookEvent.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.chatwootMessage.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.smartList.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.campaign.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.campaignSend.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } })
  ]);

  // Backfill join tables for multi-tenant mappings.
  await prisma.subscriptionPlanTenant.createMany({
    data: (await prisma.subscriptionPlan.findMany({ where: { tenantId: { not: null } }, select: { id: true, tenantId: true } })).map((p) => ({
      planId: p.id,
      tenantId: p.tenantId as string
    })),
    skipDuplicates: true
  });
  await prisma.subscriptionTenant.createMany({
    data: (await prisma.subscription.findMany({ where: { tenantId: { not: null } }, select: { id: true, tenantId: true } })).map((s) => ({
      subscriptionId: s.id,
      tenantId: s.tenantId as string
    })),
    skipDuplicates: true
  });
  await prisma.saUserTenant.createMany({
    data: (await prisma.saUser.findMany({ where: { tenantId: { not: null } }, select: { id: true, tenantId: true } })).map((u) => ({
      userId: u.id,
      tenantId: u.tenantId as string
    })) as any,
    skipDuplicates: true
  });

  // SUPER_ADMIN users: ensure they belong to all tenants.
  const allTenants = await prisma.saTenant.findMany({ select: { id: true } });
  const superAdmins = await prisma.saUser.findMany({ where: { role: "SUPER_ADMIN", active: true }, select: { id: true } });
  if (allTenants.length && superAdmins.length) {
    const rows: any[] = [];
    for (const u of superAdmins) {
      for (const t of allTenants) rows.push({ userId: u.id, tenantId: t.id });
    }
    await prisma.saUserTenant.createMany({ data: rows as any, skipDuplicates: true });
  }

  const counts = {
    saUsers: updatedNull.count,
    customers: backfills[0].count,
    plans: backfills[1].count,
    checkoutTemplates: backfills[2].count,
    subscriptions: backfills[3].count,
    payments: backfills[4].count,
    paymentLinks: backfills[5].count,
    webhookEvents: backfills[6].count,
    chatwootMsgs: backfills[7].count,
    smartLists: backfills[8].count,
    campaigns: backfills[9].count,
    campaignSends: backfills[10].count
  };

  if (Object.values(counts).some((v) => Number(v) > 0)) {
    console.log("seed-default-tenant: backfilled tenantId", counts);
  }
}

main()
  .catch((err) => {
    console.error("seed-default-tenant: failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
