const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { randomUUID } = require("crypto");

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueSuffix() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function ensureTenant() {
  const tenantName = String(process.env.DEFAULT_TENANT_NAME || "apiflujos").trim() || "apiflujos";
  const existing = await prisma.saTenant.findFirst({ where: { name: tenantName } });
  if (existing) return existing;
  return prisma.saTenant.create({ data: { name: tenantName, active: true } });
}

async function upsertCustomer({ tenantId, name, email, phone, metadata }) {
  return prisma.customer.upsert({
    where: { email },
    update: { name, phone, metadata, tenantId },
    create: { tenantId, name, email, phone, metadata }
  });
}

async function upsertPlan({ tenantId, name, priceInCents, intervalUnit, intervalCount, metadata, planType }) {
  return prisma.subscriptionPlan.upsert({
    where: { name },
    update: { tenantId, priceInCents, intervalUnit, intervalCount, metadata, planType, active: true },
    create: { tenantId, name, priceInCents, intervalUnit, intervalCount, metadata, planType, active: true }
  });
}

async function ensureSubscription({ tenantId, customerId, planId, metadata }) {
  const existing = await prisma.subscription.findFirst({ where: { tenantId, customerId, planId } });
  if (existing) return existing;
  const now = new Date();
  return prisma.subscription.create({
    data: {
      tenantId,
      customerId,
      planId,
      status: "ACTIVE",
      startAt: now,
      currentPeriodStartAt: now,
      currentPeriodEndAt: addDays(now, 30),
      currentCycle: 1,
      metadata: metadata || null
    }
  });
}

async function ensureCartTemplate({ tenantId, name, productIds }) {
  const existing = await prisma.publicCheckoutTemplate.findFirst({ where: { tenantId, name, kind: "CART" } });
  if (existing) return existing;
  return prisma.publicCheckoutTemplate.create({
    data: {
      tenantId,
      name,
      kind: "CART",
      allowProductSelect: true,
      productIds,
      publicTitle: "Selecciona tu plan",
      publicDescription: "Demo de catálogo con planes manuales y autodebito",
      layout: { primaryColor: "#6C4CC4" }
    }
  });
}

async function createPaymentLink({ tenantId, customerId, subscriptionId, planId, amountInCents }) {
  const reference = `DEMO-${uniqueSuffix()}`.toUpperCase();
  const payment = await prisma.payment.create({
    data: {
      tenantId,
      customerId,
      subscriptionId,
      amountInCents,
      currency: "COP",
      reference,
      status: "PENDING"
    }
  });
  const wompiPaymentLinkId = `wpl_demo_${uniqueSuffix()}`;
  const checkoutUrl = `https://checkout.wompi.co/p/${payment.id}`;
  return prisma.paymentLink.create({
    data: {
      tenantId,
      planId,
      subscriptionId,
      paymentId: payment.id,
      wompiPaymentLinkId,
      checkoutUrl,
      status: "SENT"
    }
  });
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

  const template = await ensureCartTemplate({
    tenantId: tenant.id,
    name: "Demo Cart",
    productIds: [planAutoDebit.id, planAutoLink.id, planManual.id]
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

  const subAutoDebit = await ensureSubscription({
    tenantId: tenant.id,
    customerId: customerAutoDebit.id,
    planId: planAutoDebit.id
  });
  const subAutoLink = await ensureSubscription({
    tenantId: tenant.id,
    customerId: customerAutoLink.id,
    planId: planAutoLink.id
  });
  await ensureSubscription({
    tenantId: tenant.id,
    customerId: customerManual.id,
    planId: planManual.id
  });

  await createPaymentLink({
    tenantId: tenant.id,
    customerId: customerAutoLink.id,
    subscriptionId: subAutoLink.id,
    planId: planAutoLink.id,
    amountInCents: planAutoLink.priceInCents
  });

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
