/* eslint-disable no-console */
const { PrismaClient, PaymentOrigin } = require("@prisma/client");
const { randomUUID } = require("crypto");
const { resolveDatabaseUrl } = require("./db_url_helper");
const {
  buildPricing,
  createSubscriptionWithCycles,
  ensureTenantLinks,
  paymentLinkStatusFromPaymentStatus
} = require("./seed_helpers");

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);
}

const prisma = new PrismaClient();

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function addMonths(date, months) {
  const value = new Date(date);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueSuffix() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function ensureTenant() {
  const tenantName = String(process.env.DEFAULT_TENANT_NAME || "apiflujos").trim() || "apiflujos";
  const existing = await prisma.saTenant.findFirst({ where: { name: { equals: tenantName, mode: "insensitive" } } });
  if (existing) return existing;
  return prisma.saTenant.create({ data: { name: tenantName, active: true } });
}

async function upsertCustomer({ tenantId, name, email, phone, metadata }) {
  const customer = await prisma.customer.upsert({
    where: { email },
    update: { name, phone, metadata, tenantId },
    create: { tenantId, name, email, phone, metadata }
  });
  await ensureTenantLinks(prisma, { tenantId, customerId: customer.id });
  return customer;
}

async function upsertPlan({ tenantId, name, priceInCents, intervalUnit, intervalCount, metadata, planType }) {
  const plan = await prisma.subscriptionPlan.upsert({
    where: { name },
    update: { tenantId, priceInCents, intervalUnit, intervalCount, metadata, planType, active: true },
    create: { tenantId, name, priceInCents, intervalUnit, intervalCount, metadata, planType, active: true }
  });
  await ensureTenantLinks(prisma, { tenantId, planId: plan.id });
  return plan;
}

async function ensureSubscription({ tenantId, customerId, plan, metadata, cycleStartDay, paymentDay, paymentTiming }) {
  const existing = await prisma.subscription.findFirst({ where: { tenantId, customerId, planId: plan.id } });
  if (existing) {
    await ensureTenantLinks(prisma, { tenantId, subscriptionId: existing.id });
    return {
      subscription: existing,
      cycles: await prisma.subscriptionBillingCycle.findMany({
        where: { subscriptionId: existing.id },
        orderBy: [{ cycleNumber: "asc" }]
      })
    };
  }

  const startAt = addMonths(new Date(), -1);
  return createSubscriptionWithCycles(prisma, {
    tenantId,
    customerId,
    planId: plan.id,
    status: "ACTIVE",
    startAt,
    currentCycle: 2,
    currentPeriodStartAt: new Date(),
    cycleStartDay,
    paymentDay,
    paymentTiming,
    graceDays: 2,
    retryCount: 0,
    maxRetries: 3,
    metadata: metadata || null,
    intervalUnit: plan.intervalUnit,
    intervalCount: plan.intervalCount,
    cyclesBack: 1,
    cyclesForward: 2
  });
}

async function createApprovedPayment({ tenantId, customerId, subscriptionId, cycleNumber, amountInCents, currency, origin }) {
  const payment = await prisma.payment.create({
    data: {
      tenantId,
      customerId,
      subscriptionId,
      amountInCents,
      currency,
      cycleNumber,
      reference: `DEMO-PAID-${uniqueSuffix()}`.toUpperCase(),
      status: "APPROVED",
      paidAt: addDays(new Date(), -10),
      origin,
      subscriptionCycleKey: `${subscriptionId}:${cycleNumber}`
    }
  });

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: 1,
      status: "APPROVED",
      provider: "wompi",
      response: { demo: true }
    }
  });

  await prisma.subscriptionBillingCycle.update({
    where: { subscriptionId_cycleNumber: { subscriptionId, cycleNumber } },
    data: {
      paymentId: payment.id,
      status: "PAID",
      paidAt: payment.paidAt,
      paidOnTime: true,
      daysEarly: 1,
      daysLate: 0,
      origin,
      associationReason: "REF_MATCH",
      associatedBy: "seed_demo"
    }
  });

  return payment;
}

async function createPaymentLink({ tenantId, customerId, subscriptionId, planId, amountInCents, cycleNumber }) {
  const reference = `DEMO-${uniqueSuffix()}`.toUpperCase();
  const payment = await prisma.payment.create({
    data: {
      tenantId,
      customerId,
      subscriptionId,
      amountInCents,
      currency: "COP",
      cycleNumber,
      reference,
      status: "PENDING",
      origin: PaymentOrigin.AUTO_LINK
    }
  });

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNo: 1,
      status: "PENDING",
      provider: "wompi",
      response: { demo: true, paymentLink: true }
    }
  });

  const wompiPaymentLinkId = `wpl_demo_${uniqueSuffix()}`;
  const checkoutUrl = `https://checkout.wompi.co/p/${payment.id}`;
  const link = await prisma.paymentLink.create({
    data: {
      tenantId,
      planId,
      subscriptionId,
      paymentId: payment.id,
      wompiPaymentLinkId,
      checkoutUrl,
      status: paymentLinkStatusFromPaymentStatus(payment.status)
    }
  });

  return { payment, link };
}

async function main() {
  const tenant = await ensureTenant();

  const autoDebitMeta = {
    kind: "CATALOG_ITEM",
    itemKind: "SERVICE",
    displayName: "Plan Autodebito Demo",
    sku: "DEMO-AUTO-DEBIT",
    collectionMode: "AUTO_DEBIT"
  };
  const autoLinkMeta = {
    kind: "CATALOG_ITEM",
    itemKind: "SERVICE",
    displayName: "Plan Link Demo",
    sku: "DEMO-AUTO-LINK",
    collectionMode: "AUTO_LINK"
  };
  const manualMeta = {
    kind: "CATALOG_ITEM",
    itemKind: "PRODUCT",
    displayName: "Plan Manual Demo",
    sku: "DEMO-MANUAL",
    collectionMode: "MANUAL_LINK"
  };

  const planAutoDebit = await upsertPlan({
    tenantId: tenant.id,
    name: "Plan Autodebito Demo",
    priceInCents: 29900,
    intervalUnit: "MONTH",
    intervalCount: 1,
    metadata: autoDebitMeta,
    planType: "auto_subscription"
  });

  const planAutoLink = await upsertPlan({
    tenantId: tenant.id,
    name: "Plan Link Demo",
    priceInCents: 19900,
    intervalUnit: "MONTH",
    intervalCount: 1,
    metadata: autoLinkMeta,
    planType: "auto_subscription"
  });

  const planManual = await upsertPlan({
    tenantId: tenant.id,
    name: "Plan Manual Demo",
    priceInCents: 9900,
    intervalUnit: "MONTH",
    intervalCount: 1,
    metadata: manualMeta,
    planType: "manual_link"
  });

  const template = await prisma.publicCheckoutTemplate.findFirst({
    where: { tenantId: tenant.id, name: "Demo Cart", kind: "CART" }
  }) || await prisma.publicCheckoutTemplate.create({
    data: {
      tenantId: tenant.id,
      name: "Demo Cart",
      kind: "CART",
      allowProductSelect: true,
      productIds: [planAutoDebit.id, planAutoLink.id, planManual.id],
      publicTitle: "Selecciona tu plan",
      publicDescription: "Demo de catalogo con planes manuales y autodebito",
      layout: { primaryColor: "#6C4CC4" }
    }
  });

  const cartToken = randomUUID().replace(/-/g, "");
  const cartExpiresAt = addDays(new Date(), 7).toISOString();

  const customerAutoDebit = await upsertCustomer({
    tenantId: tenant.id,
    name: "Cliente Autodebito Demo",
    email: `auto.debit.demo+${uniqueSuffix()}@example.com`,
    phone: "+57 3000000001",
    metadata: {
      wompi: { paymentSourceId: 123456, paymentSources: [{ id: 123456, type: "CARD", createdAt: nowIso() }] },
      cartLink: { token: cartToken, expiresAt: cartExpiresAt, templateId: template.id }
    }
  });

  const customerAutoLink = await upsertCustomer({
    tenantId: tenant.id,
    name: "Cliente Link Demo",
    email: `auto.link.demo+${uniqueSuffix()}@example.com`,
    phone: "+57 3000000002",
    metadata: {
      cartLink: { token: cartToken, expiresAt: cartExpiresAt, templateId: template.id }
    }
  });

  const customerManual = await upsertCustomer({
    tenantId: tenant.id,
    name: "Cliente Manual Demo",
    email: `manual.demo+${uniqueSuffix()}@example.com`,
    phone: "+57 3000000003",
    metadata: {
      cartLink: { token: cartToken, expiresAt: cartExpiresAt, templateId: template.id }
    }
  });

  const pricingAutoDebit = buildPricing(planAutoDebit, 0, "COP");
  const pricingAutoLink = buildPricing(planAutoLink, 0, "COP");
  const pricingManual = buildPricing(planManual, 0, "COP");

  const autoDebitResult = await ensureSubscription({
    tenantId: tenant.id,
    customerId: customerAutoDebit.id,
    plan: planAutoDebit,
    cycleStartDay: 1,
    paymentDay: 5,
    paymentTiming: "EN_CURSO",
    metadata: {
      pricing: pricingAutoDebit,
      collectionMode: "AUTO_DEBIT",
      paymentSourceId: 123456
    }
  });

  const autoLinkResult = await ensureSubscription({
    tenantId: tenant.id,
    customerId: customerAutoLink.id,
    plan: planAutoLink,
    cycleStartDay: 1,
    paymentDay: 10,
    paymentTiming: "EN_CURSO",
    metadata: {
      pricing: pricingAutoLink,
      collectionMode: "AUTO_LINK"
    }
  });

  await ensureSubscription({
    tenantId: tenant.id,
    customerId: customerManual.id,
    plan: planManual,
    cycleStartDay: 15,
    paymentDay: 12,
    paymentTiming: "ANTICIPADO",
    metadata: {
      pricing: pricingManual,
      collectionMode: "MANUAL_LINK"
    }
  });

  const autoDebitPaidCycle = autoDebitResult.cycles.find((cycle) => cycle.cycleNumber === 1) || autoDebitResult.cycles[0];
  if (autoDebitPaidCycle && !autoDebitPaidCycle.paymentId) {
    await createApprovedPayment({
      tenantId: tenant.id,
      customerId: customerAutoDebit.id,
      subscriptionId: autoDebitResult.subscription.id,
      cycleNumber: autoDebitPaidCycle.cycleNumber,
      amountInCents: pricingAutoDebit.totalInCents,
      currency: "COP",
      origin: PaymentOrigin.AUTO_DEBIT
    });
  }

  const autoLinkCurrentCycle = autoLinkResult.cycles.find((cycle) => cycle.cycleNumber === 2) || autoLinkResult.cycles[autoLinkResult.cycles.length - 1];
  if (autoLinkCurrentCycle) {
    await createPaymentLink({
      tenantId: tenant.id,
      customerId: customerAutoLink.id,
      subscriptionId: autoLinkResult.subscription.id,
      planId: planAutoLink.id,
      amountInCents: pricingAutoLink.totalInCents,
      cycleNumber: autoLinkCurrentCycle.cycleNumber
    });
  }

  console.log("seed-demo: ok");
  console.log("tenantId:", tenant.id);
  console.log("cartToken:", cartToken);
}

main()
  .catch((err) => {
    console.error("seed-demo: failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
