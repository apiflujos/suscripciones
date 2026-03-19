/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pad(n) {
  return String(n).padStart(3, "0");
}

function toCents(v) {
  return Math.trunc(Number(v || 0));
}

function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function getTenant() {
  const tenant = await prisma.saTenant.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" }
  });
  if (!tenant) throw new Error("no_active_tenant");
  return tenant;
}

async function main() {
  const tenant = await getTenant();
  const tenantId = tenant.id;
  const currency = "COP";
  const seedTag = Date.now().toString(36);

  const productCount = 10;
  const customerCount = 30;
  const empresaCount = 6;
  const subscriptionCount = 40;
  const paymentCount = 80;

  console.log("Seeding local DB", { tenantId, tenantName: tenant.name });

  // Customers (some with saved card metadata)
  const customers = [];
  for (let i = 1; i <= customerCount; i += 1) {
    const email = `dummy_${seedTag}_${pad(i)}@example.com`;
    const hasCard = i % 4 === 0;
    const cardSourceId = hasCard ? 100000 + i : null;
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        name: `Cliente ${pad(i)}`,
        email,
        phone: `300000${pad(i)}`,
        metadata: hasCard
          ? {
              wompi: {
                paymentSourceId: cardSourceId,
                paymentSourceType: "CARD",
                paymentSources: [{ id: cardSourceId, type: "CARD", createdAt: new Date().toISOString() }]
              }
            }
          : undefined
      }
    });
    await prisma.customerTenant.create({
      data: { customerId: customer.id, tenantId }
    });
    customers.push(customer);
  }

  // Empresas + Contactos
  const empresas = [];
  const contactos = [];
  for (let i = 1; i <= empresaCount; i += 1) {
    const empresa = await prisma.empresa.create({
      data: {
        tenantId,
        nombre: `Empresa ${pad(i)} · Mercado de vinos`,
        email: `empresa_${seedTag}_${pad(i)}@empresa.com`,
        telefono: `320000${pad(i)}`,
        direccion: `Calle ${10 + i} #${i} - ${20 + i}`,
        sitioWeb: `https://empresa${pad(i)}.local`
      }
    });
    const contactsForEmpresa = [];
    const totalContacts = 2 + (i % 3);
    for (let j = 1; j <= totalContacts; j += 1) {
      const contact = await prisma.contacto.create({
        data: {
          empresaId: empresa.id,
          nombre: `Contacto ${pad(i)}-${pad(j)}`,
          email: `contacto_${seedTag}_${pad(i)}_${pad(j)}@empresa.com`,
          telefono: `310${pad(i)}${pad(j)}${pad(j)}`.slice(0, 10),
          cargo: j === 1 ? "Gerente" : j === 2 ? "Compras" : "Administración"
        }
      });
      contactsForEmpresa.push(contact);
      contactos.push(contact);
    }
    if (contactsForEmpresa.length) {
      await prisma.empresa.update({
        where: { id: empresa.id },
        data: { contactoPrincipalId: contactsForEmpresa[0].id }
      });
    }
    empresas.push(empresa);
  }

  // Catalog products (stored as SubscriptionPlan with metadata.kind = CATALOG_ITEM)
  const catalogPlans = [];
  for (let i = 1; i <= productCount; i += 1) {
    const sku = `SKU-${seedTag}-${pad(i)}`;
    const itemKind = i % 3 === 0 ? "SERVICE" : "PRODUCT";
    const requiresShipping = itemKind === "PRODUCT" && i % 2 === 0;
    const shippingInCents = requiresShipping ? (i % 4 === 0 ? 0 : 20000) : 0;
    const basePriceInCents = 25000 + i * 1500;
    const plan = await prisma.subscriptionPlan.create({
      data: {
        tenantId,
        name: `[${sku}] Producto ${pad(i)}`,
        currency,
        priceInCents: basePriceInCents,
        intervalUnit: "MONTH",
        intervalCount: 1,
        planType: i % 2 === 0 ? "manual_link" : "auto_subscription",
        metadata: {
          kind: "CATALOG_ITEM",
          sku,
          displayName: `Producto ${pad(i)}`,
          itemKind,
          collectionMode: i % 2 === 0 ? "AUTO_LINK" : "AUTO_DEBIT",
          requiresShipping,
          pricing: {
            basePriceInCents,
            shippingInCents,
            taxPercent: 0,
            discountType: "NONE",
            discountValueInCents: 0,
            discountPercent: 0
          }
        }
      }
    });
    await prisma.subscriptionPlanTenant.createMany({
      data: [{ planId: plan.id, tenantId }],
      skipDuplicates: true
    });
    catalogPlans.push({ plan, requiresShipping, shippingInCents });
  }

  // Subscription plans (non-catalog, used for subscriptions)
  const plans = [];
  for (let i = 1; i <= 8; i += 1) {
    const basePriceInCents = 40000 + i * 5000;
    const itemKind = i % 2 === 0 ? "PRODUCT" : "SERVICE";
    const requiresShipping = itemKind === "PRODUCT";
    const shippingInCents = requiresShipping ? (i % 3 === 0 ? 0 : 20000) : 0;
    const plan = await prisma.subscriptionPlan.create({
      data: {
        tenantId,
        name: `Plan ${seedTag} ${pad(i)}`,
        currency,
        priceInCents: basePriceInCents,
        intervalUnit: "MONTH",
        intervalCount: 1,
        planType: i % 2 === 0 ? "auto_subscription" : "manual_link",
        metadata: {
          catalog: { kind: itemKind },
          pricing: {
            basePriceInCents,
            shippingInCents,
            taxPercent: 0,
            discountType: "NONE",
            discountValueInCents: 0,
            discountPercent: 0
          }
        }
      }
    });
    await prisma.subscriptionPlanTenant.createMany({
      data: [{ planId: plan.id, tenantId }],
      skipDuplicates: true
    });
    plans.push({ plan, requiresShipping, shippingInCents });
  }

  // Subscriptions
  const statuses = ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED", "SUSPENDED"];
  const subscriptions = [];
  for (let i = 1; i <= subscriptionCount; i += 1) {
    const customer = rand(customers);
    const picked = rand(plans);
    const status = rand(statuses);
    const attachCompany = i % 3 === 0 && contactos.length > 0;
    const contact = attachCompany ? rand(contactos) : null;
    const empresaId = contact ? contact.empresaId : null;
    const contactoId = contact ? contact.id : null;
    const now = new Date();
    const currentPeriodEndAt =
      status === "ACTIVE" ? nowPlusDays(15) : status === "PAST_DUE" ? nowPlusDays(-10) : nowPlusDays(-30);
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        customerId: customer.id,
        empresaId,
        contactoId,
        planId: picked.plan.id,
        status,
        startAt: now,
        currentPeriodStartAt: nowPlusDays(-20),
        currentPeriodEndAt,
        currentCycle: Math.floor(Math.random() * 6) + 1,
        retryCount: status === "PAST_DUE" ? 2 : 0,
        maxRetries: 3,
        canceledAt: status === "CANCELED" ? nowPlusDays(-5) : null,
        suspendedAt: status === "SUSPENDED" ? nowPlusDays(-3) : null,
        metadata: {
          pricing: {
            basePriceInCents: picked.plan.priceInCents,
            shippingInCents: picked.shippingInCents,
            totalInCents: picked.plan.priceInCents + picked.shippingInCents,
            currency
          },
          collectionMode: picked.plan.planType === "auto_subscription" ? "AUTO_DEBIT" : "MANUAL_LINK",
          paymentSourceId: (customer.metadata && customer.metadata.wompi && customer.metadata.wompi.paymentSourceId) || null,
          empresaId,
          contactoId
        }
      }
    });
    await prisma.subscriptionTenant.createMany({
      data: [{ subscriptionId: subscription.id, tenantId }],
      skipDuplicates: true
    });
    subscriptions.push(subscription);
  }

  // Payments + PaymentLinks
  const paymentStatuses = ["APPROVED", "DECLINED", "PENDING", "ERROR"];
  for (let i = 1; i <= paymentCount; i += 1) {
    const customer = rand(customers);
    const subscription = Math.random() > 0.3 ? rand(subscriptions) : null;
    const status = rand(paymentStatuses);
    const amountInCents = 30000 + (i % 10) * 5000;
    const reference = `PAY_${seedTag}_${pad(i)}`;
    const payment = await prisma.payment.create({
      data: {
        tenantId,
        customerId: customer.id,
        subscriptionId: subscription?.id || null,
        amountInCents,
        currency,
        cycleNumber: subscription ? (subscription.currentCycle || 1) : null,
        reference,
        status,
        paidAt: status === "APPROVED" ? nowPlusDays(-1) : null,
        failedAt: status === "DECLINED" || status === "ERROR" ? nowPlusDays(-1) : null
      }
    });

    await prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNo: 1,
        status,
        provider: "wompi",
        response: { seed: true }
      }
    });

    // Create payment link for manual_link subscriptions
    if (subscription) {
      const plan = plans.find((p) => p.plan.id === subscription.planId);
      if (plan && plan.plan.planType === "manual_link") {
        const linkStatus = status === "APPROVED" ? "PAID" : status === "DECLINED" ? "FAILED" : "SENT";
        await prisma.paymentLink.create({
          data: {
            tenantId,
            planId: subscription.planId,
            subscriptionId: subscription.id,
            paymentId: payment.id,
            wompiPaymentLinkId: `wpl_${seedTag}_${pad(i)}`,
            checkoutUrl: `https://checkout.local/${seedTag}/${pad(i)}`,
            status: linkStatus,
            paidAt: linkStatus === "PAID" ? nowPlusDays(-1) : null
          }
        });
      }
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
