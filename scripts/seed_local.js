/* eslint-disable no-console */
const { PrismaClient, PaymentOrigin } = require("@prisma/client");
const curatedMembers = require("../packages/core/src/scripts/mdv-abril2026-curated-data");
const { resolveDatabaseUrl } = require("./db_url_helper");
const {
  createSubscriptionWithCycles,
  ensureTenantLinks,
  paymentLinkStatusFromPaymentStatus
} = require("./seed_helpers");

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);
}

const prisma = new PrismaClient();

const TENANT_NAME = "Mercado de vinos";
const PLAN_DEFS = [
  { category: "ALPHA", name: "Suscripción Alpha", basePriceInCents: 36000000 },
  { category: "OMEGA", name: "Suscripción Omega", basePriceInCents: 46000000 },
  { category: "DELTA", name: "Suscripción Delta", basePriceInCents: 62000000 }
];

function normalize(value) {
  return String(value || "").trim();
}

function normEmail(value) {
  return normalize(value).toLowerCase();
}

function planDefByCategory(category) {
  return PLAN_DEFS.find((item) => item.category === category) || null;
}

function inferShipping(member) {
  const def = planDefByCategory(member.category);
  const basePriceInCents = Number(member.basePriceInCents || def?.basePriceInCents || 0);
  const totalInCents = Number(member.amountInCents || basePriceInCents || 0);
  const explicitShipping = member.shippingInCents;
  const shippingInCents =
    explicitShipping != null ? Math.max(0, Number(explicitShipping || 0)) : Math.max(0, totalInCents - basePriceInCents);
  const label = normalize(member.planLabel).toLowerCase();
  const requiresShipping = member.requiresShipping != null ? Boolean(member.requiresShipping) : label.includes("domicilio") || shippingInCents > 0;
  return {
    basePriceInCents,
    shippingInCents,
    totalInCents,
    requiresShipping
  };
}

function inferCurrentPeriodStartAt() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

async function getTenant() {
  let tenant = await prisma.saTenant.findFirst({
    where: { name: { equals: TENANT_NAME, mode: "insensitive" } }
  });
  if (!tenant) {
    tenant = await prisma.saTenant.create({ data: { name: TENANT_NAME, active: true } });
  }
  return tenant;
}

async function cleanupPreviousSeed(tenantId) {
  const seededPlans = await prisma.subscriptionPlan.findMany({
    where: { tenantId, metadata: { path: ["importSource"], equals: "seed:mdv-curated" } },
    select: { id: true }
  });
  const seededPlanIds = seededPlans.map((item) => item.id);
  const seededSubscriptions = await prisma.subscription.findMany({
    where: { tenantId, metadata: { path: ["importSource"], equals: "seed:mdv-curated" } },
    select: { id: true }
  });
  const subscriptionIds = seededSubscriptions.map((item) => item.id);

  if (!subscriptionIds.length) return;

  const payments = await prisma.payment.findMany({
    where: { subscriptionId: { in: subscriptionIds } },
    select: { id: true }
  });
  const paymentIds = payments.map((item) => item.id);

  await prisma.paymentLink.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
  await prisma.chatwootMessage.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } }).catch(() => {});
  await prisma.subscriptionBillingCycle.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
  if (paymentIds.length) {
    await prisma.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } });
  }
  await prisma.payment.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
  await prisma.subscriptionTenant.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
  await prisma.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });

  if (seededPlanIds.length) {
    await prisma.subscriptionPlanTenant.deleteMany({ where: { planId: { in: seededPlanIds } } });
    await prisma.subscriptionPlan.deleteMany({ where: { id: { in: seededPlanIds } } });
  }
}

async function ensureCanonicalPlans(tenantId) {
  const plans = new Map();
  for (const def of PLAN_DEFS) {
    const plan = await prisma.subscriptionPlan.create({
      data: {
        tenantId,
        name: def.name,
        priceInCents: def.basePriceInCents,
        currency: "COP",
        intervalUnit: "MONTH",
        intervalCount: 1,
        planType: "auto_subscription",
        active: true,
        metadata: {
          importSource: "seed:mdv-curated",
          mdvCanonical: true,
          mdvCategory: def.category,
          collectionMode: "MANUAL_LINK"
        }
      }
    });
    await ensureTenantLinks(prisma, { tenantId, planId: plan.id });
    plans.set(def.category, plan);
  }
  return plans;
}

async function upsertCustomer(tenantId, member) {
  const email = normEmail(member.correo) || `mdv-curated-${member.category.toLowerCase()}-${member.rowNum}@placeholder.apiflujos.local`;
  const customer = await prisma.customer.upsert({
    where: { email },
    update: {
      tenantId,
      name: member.nombre,
      phone: normalize(member.celular) || null,
      metadata: {
        identificacion: normalize(member.identificacion) || null,
        address: { line1: normalize(member.direccion) || null, city: normalize(member.ciudad) || null },
        mdv: {
          curated: true,
          rowNum: member.rowNum,
          category: member.category,
          planLabel: member.planLabel
        },
        importSource: "seed:mdv-curated"
      }
    },
    create: {
      tenantId,
      email,
      name: member.nombre,
      phone: normalize(member.celular) || null,
      metadata: {
        identificacion: normalize(member.identificacion) || null,
        address: { line1: normalize(member.direccion) || null, city: normalize(member.ciudad) || null },
        mdv: {
          curated: true,
          rowNum: member.rowNum,
          category: member.category,
          planLabel: member.planLabel
        },
        importSource: "seed:mdv-curated"
      }
    }
  });
  await ensureTenantLinks(prisma, { tenantId, customerId: customer.id });
  return customer;
}

async function createPaymentArtifacts(args) {
  const { tenantId, customerId, subscription, cycle, member, pricing } = args;
  if (member.paymentStatus === "APPROVED") {
    const paidAt = member.paidAt ? new Date(member.paidAt) : new Date();
    const payment = await prisma.payment.create({
      data: {
        tenantId,
        customerId,
        subscriptionId: subscription.id,
        amountInCents: pricing.totalInCents,
        currency: "COP",
        cycleNumber: cycle.cycleNumber,
        reference: `SUB_${subscription.id}_${cycle.cycleNumber}`,
        status: "APPROVED",
        paidAt,
        origin: member.collectionMode === "AUTO_DEBIT" ? PaymentOrigin.AUTO_DEBIT : PaymentOrigin.MANUAL_LINK,
        subscriptionCycleKey: `${subscription.id}:${cycle.cycleNumber}`,
        ...(member.wompiTransactionId ? { wompiTransactionId: member.wompiTransactionId } : {})
      }
    });

    await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNo: 1,
        status: "APPROVED",
        provider: "wompi",
        response: {
          seed: true,
          importSource: "seed:mdv-curated",
          ...(member.wompiTransactionId ? { wompiTransactionId: member.wompiTransactionId } : {})
        }
      }
    });

    await prisma.subscriptionBillingCycle.update({
      where: { subscriptionId_cycleNumber: { subscriptionId: subscription.id, cycleNumber: cycle.cycleNumber } },
      data: {
        paymentId: payment.id,
        status: "PAID",
        paidAt,
        paidOnTime: true,
        daysEarly: 0,
        daysLate: 0,
        origin: payment.origin,
        associationReason: member.wompiTransactionId ? "TX_MATCH" : "MANUAL_RECONCILE",
        associatedBy: "seed:mdv-curated"
      }
    });

    return;
  }

  if (member.collectionMode !== "MANUAL_LINK") return;

  const payment = await prisma.payment.create({
    data: {
      tenantId,
      customerId,
      subscriptionId: subscription.id,
      amountInCents: pricing.totalInCents,
      currency: "COP",
      cycleNumber: cycle.cycleNumber,
      reference: `LINK_${subscription.id}_${cycle.cycleNumber}`,
      status: "PENDING",
      origin: PaymentOrigin.MANUAL_LINK
    }
  });

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: 1,
      status: "PENDING",
      provider: "wompi",
      response: { seed: true, importSource: "seed:mdv-curated", kind: "payment_link" }
    }
  });

  await prisma.paymentLink.create({
    data: {
      tenantId,
      planId: subscription.planId,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      wompiPaymentLinkId: `wpl_mdv_${subscription.id.slice(0, 8)}_${cycle.cycleNumber}`,
      checkoutUrl: `https://checkout.local/mdv/${subscription.id}/${cycle.cycleNumber}`,
      status: paymentLinkStatusFromPaymentStatus("PENDING")
    }
  });
}

async function main() {
  const tenant = await getTenant();
  const currentPeriodStartAt = inferCurrentPeriodStartAt();

  console.log("Seeding curated MDV local dataset", { tenantId: tenant.id, subscriptions: curatedMembers.length });

  await cleanupPreviousSeed(tenant.id);
  const plans = await ensureCanonicalPlans(tenant.id);

  for (const member of curatedMembers) {
    const pricing = inferShipping(member);
    const customer = await upsertCustomer(tenant.id, member);
    const plan = plans.get(member.category);
    const { subscription, cycles } = await createSubscriptionWithCycles(prisma, {
      tenantId: tenant.id,
      customerId: customer.id,
      planId: plan.id,
      status: member.subscriptionStatus || "ACTIVE",
      startAt: currentPeriodStartAt,
      currentCycle: Number(member.cycleNumber || 1),
      currentPeriodStartAt,
      cycleStartDay: 1,
      paymentDay: 1,
      paymentTiming: "EN_CURSO",
      graceDays: 1,
      retryCount: 0,
      maxRetries: 3,
      metadata: {
        importSource: "seed:mdv-curated",
        collectionMode: member.collectionMode,
        billingPeriodMonths: Number(member.billingPeriodMonths || 1),
        requiresShipping: pricing.requiresShipping,
        planLabel: member.planLabel,
        pricing: {
          basePriceInCents: pricing.basePriceInCents,
          shippingInCents: pricing.shippingInCents,
          totalInCents: pricing.totalInCents,
          currency: "COP"
        }
      },
      intervalUnit: "MONTH",
      intervalCount: Number(member.billingPeriodMonths || 1),
      cyclesBack: 0,
      cyclesForward: 1
    });

    const cycle = cycles.find((item) => item.cycleNumber === Number(member.cycleNumber || 1)) || cycles[0];
    if (cycle) {
      await prisma.subscriptionBillingCycle.update({
        where: { subscriptionId_cycleNumber: { subscriptionId: subscription.id, cycleNumber: cycle.cycleNumber } },
        data: {
          status: member.cycleStatus === "PAID" ? "PAID" : "PENDING",
          associatedBy: "seed:mdv-curated"
        }
      });
      await createPaymentArtifacts({
        tenantId: tenant.id,
        customerId: customer.id,
        subscription,
        cycle,
        member,
        pricing
      });
    }
  }

  console.log("Seed complete.", { plans: PLAN_DEFS.length, subscriptions: curatedMembers.length });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
