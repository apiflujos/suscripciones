/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");
const { resolveDatabaseUrl } = require("./db_url_helper");

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);
}

const prisma = new PrismaClient();

function normalize(value) {
  return String(value || "").trim();
}

async function main() {
  const name =
    normalize(process.env.SA_DEFAULT_TENANT_NAME) ||
    normalize(process.env.DEFAULT_TENANT_NAME) ||
    "Mercado de vinos";

  if (!name) {
    console.log("seed-bootstrap: missing tenant name, skipping");
    return;
  }

  let tenant = await prisma.saTenant.findFirst({
    where: { name: { equals: name, mode: "insensitive" } }
  });

  if (!tenant) {
    tenant = await prisma.saTenant.create({ data: { name, active: true } });
    console.log("seed-bootstrap: created tenant", { id: tenant.id, name: tenant.name });
  } else {
    console.log("seed-bootstrap: found tenant", { id: tenant.id, name: tenant.name });
  }

  await prisma.saModuleDefinition.upsert({
    where: { key: "ai" },
    create: { key: "ai", name: "Inteligencia artificial", active: false },
    update: { name: "Inteligencia artificial" }
  });

  const updatedUsers = await prisma.saUser.updateMany({
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
    prisma.subscriptionPlan.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } })
  ]);

  const customers = await prisma.customer.findMany({
    where: { tenantId: { not: null } },
    select: { id: true, tenantId: true }
  });
  const plans = await prisma.subscriptionPlan.findMany({
    where: { tenantId: { not: null } },
    select: { id: true, tenantId: true }
  });
  const subscriptions = await prisma.subscription.findMany({
    select: { id: true, tenantId: true }
  });
  const users = await prisma.saUser.findMany({
    where: { tenantId: { not: null } },
    select: { id: true, tenantId: true }
  });

  await prisma.customerTenant.createMany({
    data: customers.map((customer) => ({
      customerId: customer.id,
      tenantId: customer.tenantId
    })),
    skipDuplicates: true
  });

  await prisma.subscriptionPlanTenant.createMany({
    data: plans.map((plan) => ({
      planId: plan.id,
      tenantId: plan.tenantId
    })),
    skipDuplicates: true
  });

  await prisma.subscriptionTenant.createMany({
    data: subscriptions.map((subscription) => ({
      subscriptionId: subscription.id,
      tenantId: subscription.tenantId
    })),
    skipDuplicates: true
  });

  await prisma.saUserTenant.createMany({
    data: users.map((user) => ({
      userId: user.id,
      tenantId: user.tenantId
    })),
    skipDuplicates: true
  });

  const allTenants = await prisma.saTenant.findMany({ select: { id: true } });
  const superAdmins = await prisma.saUser.findMany({
    where: { role: "SUPER_ADMIN", active: true },
    select: { id: true }
  });
  if (allTenants.length && superAdmins.length) {
    const rows = [];
    for (const user of superAdmins) {
      for (const existingTenant of allTenants) {
        rows.push({ userId: user.id, tenantId: existingTenant.id });
      }
    }
    await prisma.saUserTenant.createMany({ data: rows, skipDuplicates: true });
  }

  const counts = {
    saUsers: updatedUsers.count,
    customers: backfills[0].count,
    plans: backfills[1].count
  };

  if (Object.values(counts).some((value) => Number(value) > 0)) {
    console.log("seed-bootstrap: backfilled tenantId", counts);
  }
}

main()
  .catch((err) => {
    console.error("seed-bootstrap: failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
