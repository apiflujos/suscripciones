#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("path");
const { spawnSync } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const { resolveDatabaseUrl } = require("./db_url_helper");

const DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);
const DRY_RUN = process.argv.includes("--dry-run");
const TENANT_NAME = process.env.MDV_TENANT_NAME || "Mercado de vinos";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL es requerida");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const migrateScript = path.resolve(__dirname, "./migrate-mdv-abril2026.js");

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferCategoryFromPlanName(name) {
  const normalized = normalizeName(name);
  if (normalized.includes("alpha")) return "ALPHA";
  if (normalized.includes("omega")) return "OMEGA";
  if (normalized.includes("delta")) return "DELTA";
  return null;
}

function isCuratedImport(metadata) {
  const importSource = String(metadata?.importSource || "").trim();
  return importSource === "seed:mdv-curated" || importSource === "migrate-mdv-abril2026-curated";
}

async function collectUniverse(tenantId) {
  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      tenantId,
      NOT: { metadata: { path: ["kind"], equals: "CATALOG_ITEM" } }
    },
    select: { id: true, name: true, metadata: true }
  });

  const targetPlans = plans.filter((plan) => inferCategoryFromPlanName(plan.name) || isCuratedImport(plan.metadata));
  const targetPlanIds = targetPlans.map((plan) => plan.id);

  const subscriptions = await prisma.subscription.findMany({
    where: { tenantId },
    include: { plan: { select: { id: true, name: true, metadata: true } } }
  });

  const targetSubscriptions = subscriptions.filter((subscription) => {
    if (targetPlanIds.includes(subscription.planId)) return true;
    if (isCuratedImport(subscription.metadata)) return true;
    return Boolean(inferCategoryFromPlanName(subscription?.plan?.name));
  });
  const subscriptionIds = targetSubscriptions.map((subscription) => subscription.id);

  const payments = subscriptionIds.length
    ? await prisma.payment.findMany({
        where: { subscriptionId: { in: subscriptionIds } },
        select: { id: true }
      })
    : [];
  const paymentIds = payments.map((payment) => payment.id);

  const paymentLinks = subscriptionIds.length
    ? await prisma.paymentLink.findMany({
        where: { subscriptionId: { in: subscriptionIds } },
        select: { id: true }
      })
    : [];

  const billingCycles = subscriptionIds.length
    ? await prisma.subscriptionBillingCycle.findMany({
        where: { subscriptionId: { in: subscriptionIds } },
        select: { id: true }
      })
    : [];

  return {
    targetPlans,
    targetPlanIds,
    targetSubscriptions,
    subscriptionIds,
    paymentIds,
    paymentLinkIds: paymentLinks.map((item) => item.id),
    billingCycleIds: billingCycles.map((item) => item.id)
  };
}

async function cleanupUniverse(universe) {
  const summary = {
    plans: universe.targetPlanIds.length,
    subscriptions: universe.subscriptionIds.length,
    payments: universe.paymentIds.length,
    paymentLinks: universe.paymentLinkIds.length,
    billingCycles: universe.billingCycleIds.length
  };

  console.log("Resumen objetivo:", summary);
  if (DRY_RUN) return summary;

  if (universe.subscriptionIds.length) {
    await prisma.retryJob.deleteMany({
      where: {
        OR: universe.subscriptionIds.map((subscriptionId) => ({
          payload: { path: ["subscriptionId"], equals: subscriptionId }
        }))
      }
    }).catch(() => {});
  }

  if (universe.subscriptionIds.length) {
    await prisma.paymentLink.deleteMany({ where: { subscriptionId: { in: universe.subscriptionIds } } });
    await prisma.chatwootMessage.deleteMany({ where: { subscriptionId: { in: universe.subscriptionIds } } }).catch(() => {});
    await prisma.subscriptionBillingCycle.deleteMany({ where: { subscriptionId: { in: universe.subscriptionIds } } });
    await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: universe.subscriptionIds } } });
  }

  if (universe.paymentIds.length) {
    await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: universe.paymentIds } } });
  }

  if (universe.subscriptionIds.length) {
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: universe.subscriptionIds } } });
    await prisma.subscription.deleteMany({ where: { id: { in: universe.subscriptionIds } } });
  }

  if (universe.targetPlanIds.length) {
    await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: { in: universe.targetPlanIds } } });
    await prisma.subscriptionPlan.deleteMany({ where: { id: { in: universe.targetPlanIds } } });
  }

  return summary;
}

function runMigration() {
  const args = [migrateScript];
  if (DRY_RUN) args.push("--dry-run");
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL }
  });
  if (result.status !== 0) {
    throw new Error(`migrate-mdv-abril2026 exited with status ${result.status}`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Reset MdV Curated");
  console.log(`  Modo: ${DRY_RUN ? "DRY RUN" : "APPLY"}`);
  console.log("═══════════════════════════════════════════════════════════════");

  await prisma.$connect();
  const tenant = await prisma.saTenant.findFirst({
    where: { name: { equals: TENANT_NAME, mode: "insensitive" } }
  });
  if (!tenant) throw new Error(`Tenant no encontrado: ${TENANT_NAME}`);

  const universe = await collectUniverse(tenant.id);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log("Planes detectados para reset:");
  for (const plan of universe.targetPlans) {
    console.log(`- ${plan.name} (${plan.id})`);
  }

  await cleanupUniverse(universe);
  await prisma.$disconnect();

  console.log("\n▶ Ejecutando recreación curada...");
  runMigration();
  console.log(`\n${DRY_RUN ? "DRY RUN completado" : "✅ Reset + recreación curada completados"}`);
}

main().catch(async (err) => {
  console.error("💥 RESET FALLIDO:", err.message || err);
  if (err.stack) console.error(err.stack);
  try {
    await prisma.$disconnect();
  } catch (_) {
    // no-op
  }
  process.exit(1);
});
