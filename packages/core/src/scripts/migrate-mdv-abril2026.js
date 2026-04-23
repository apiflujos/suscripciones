#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Migracion MdV - Abril 2026
 *
 * Fuente de verdad:
 *  - Por defecto usa `mdv-abril2026-curated-data.js`
 *  - Opcionalmente puede auditar Wompi para confirmar tx ids por email+valor
 *
 * Objetivo:
 *  1. Usar solo el listado curado, no toda la hoja Excel
 *  2. Corregir plan, collectionMode, periodicidad, estado de suscripcion y ciclo
 *  3. Crear o actualizar pago/ciclo con tx de Wompi solo cuando la evidencia sea consistente
 *  4. Dejar un resumen de candidatos con mismatch para revision manual
 *
 * Uso:
 *   DATABASE_URL=postgresql://... node migrate-mdv-abril2026.js --dry-run
 *   DATABASE_URL=postgresql://... node migrate-mdv-abril2026.js
 */

const XLSX = require("xlsx");
const path = require("path");
const curatedMembers = require("./mdv-abril2026-curated-data");
const { resolveDatabaseUrl } = require("./db_url_helper");

const DRY_RUN = process.argv.includes("--dry-run");
const DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL es requerida");
  process.exit(1);
}

const REPO_ROOT = path.resolve(__dirname, "../../../../");
const WOMPI_XLSX =
  process.env.MDV_WOMPI_XLSX ||
  path.resolve(REPO_ROOT, "Assets/suscricpiones_activas/Wompi .xlsx");

const TENANT_NAME = "Mercado de vinos";
const APRIL_2026 = new Date("2026-04-01T00:00:00.000Z");
const PLAN_DEFS = [
  { category: "ALPHA", name: "Suscripción Alpha", basePriceInCents: 36000000 },
  { category: "OMEGA", name: "Suscripción Omega", basePriceInCents: 46000000 },
  { category: "DELTA", name: "Suscripción Delta", basePriceInCents: 62000000 },
];
const PLAN_DEF_BY_CATEGORY = new Map(PLAN_DEFS.map((item) => [item.category, item]));

const CYCLE_START_DAY = Math.max(1, Math.min(31, parseInt(process.env.MDV_CYCLE_START_DAY || "1", 10)));
const PAYMENT_DAY = Math.max(1, Math.min(31, parseInt(process.env.MDV_PAYMENT_DAY || "1", 10)));
const PAYMENT_TIMING =
  (process.env.MDV_PAYMENT_TIMING || "EN_CURSO").toUpperCase() === "ANTICIPADO" ? "ANTICIPADO" : "EN_CURSO";
const GRACE_DAYS = Math.max(0, parseInt(process.env.MDV_GRACE_DAYS || "1", 10));

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const MES_ES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11,
};

function normEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function addMonths(date, n) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  return new Date(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
}

function clampDay(y, m, d) {
  const maxD = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, maxD)));
}

function computeDueAt(periodStartAt, cycleStartDay, paymentDay, paymentTiming) {
  const csd = Math.max(1, Math.min(31, cycleStartDay || 1));
  const pd = Math.max(1, Math.min(31, paymentDay || 1));
  const start = new Date(periodStartAt);
  if (paymentTiming === "ANTICIPADO") {
    const m = start.getUTCMonth() - 1;
    return clampDay(start.getUTCFullYear() + (m < 0 ? -1 : 0), (m + 12) % 12, pd);
  }
  if (pd >= csd) return clampDay(start.getUTCFullYear(), start.getUTCMonth(), pd);
  const m = start.getUTCMonth() + 1;
  return clampDay(start.getUTCFullYear() + (m > 11 ? 1 : 0), m % 12, pd);
}

function wompiAmountToCents(raw) {
  const noDecimal = String(raw || "").replace(/,\d+$/, "");
  const digits = noDecimal.replace(/[^\d]/g, "");
  return digits ? Number(digits) * 100 : null;
}

function inferCollectionMode(member) {
  if (member.collectionMode) return member.collectionMode;
  return String(member.planLabel || "").toLowerCase().includes("suscrip") ? "AUTO_DEBIT" : "MANUAL_LINK";
}

function inferShipping(member) {
  const planDef = PLAN_DEF_BY_CATEGORY.get(member.category);
  const basePriceInCents = Number(member.basePriceInCents || planDef?.basePriceInCents || 0);
  const totalInCents = Number(member.amountInCents || 0);
  const explicitShipping = member.shippingInCents;
  const shippingInCents = explicitShipping != null
    ? Math.max(0, Number(explicitShipping || 0))
    : Math.max(0, totalInCents - basePriceInCents);
  const label = String(member.planLabel || "").toLowerCase();
  const requiresShipping = member.requiresShipping != null
    ? Boolean(member.requiresShipping)
    : label.includes("con domicilio") || shippingInCents > 0;
  return {
    basePriceInCents,
    shippingInCents,
    totalInCents,
    requiresShipping,
  };
}

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

function parseWompiXlsx(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const payments = [];
  let i = 0;
  const VALID = ["APROBADA", "APROBADO", "PENDIENTE", "DECLINADA", "RECHAZADA", "ERROR", "FALLIDA", "PAGADA", "PAGADO"];

  while (i < rows.length) {
    const r0 = rows[i] || [];
    const estadoRaw = String(r0[0] || "").trim().toUpperCase();
    if (!VALID.includes(estadoRaw)) {
      i += 1;
      continue;
    }

    const estado = ["PAGADA", "PAGADO", "APROBADO"].includes(estadoRaw) ? "APROBADA" : estadoRaw;
    const fecha = String(r0[3] || r0[2] || "").trim();
    let paidAt = null;
    const fm = fecha.match(/(\w+)\.\s*(\d+)\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (fm) {
      const mesIdx = MES_ES[fm[1].toLowerCase()];
      const dia = parseInt(fm[2], 10);
      let hour = parseInt(fm[3], 10);
      const min = parseInt(fm[4], 10);
      const meridiem = fm[5].toUpperCase();
      if (meridiem === "PM" && hour !== 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;
      if (mesIdx !== undefined && dia > 0) paidAt = new Date(Date.UTC(2026, mesIdx, dia, hour, min, 0));
    }

    const r1 = rows[i + 1] || [];
    const col1 = String(r1[1] || "").trim();
    const match = col1.match(/^COP\s*[$]?([\d.,]+)\s*(.+)$/i);
    if (match) {
      const email = normEmail(match[2]);
      if (email) {
        const r2 = rows[i + 2] || [];
        const ref = String(r2[2] || r2[1] || "").trim().replace(/^Ref:\s*/i, "").trim();
        payments.push({
          estado,
          paidAt,
          amountInCents: wompiAmountToCents(match[1]),
          email,
          transaccionId: String(r1[2] || "").trim(),
          ref,
        });
      }
    }
    i += 3;
  }

  return payments;
}

function prepareMembers() {
  const seenEmails = new Set();
  return curatedMembers.map((member) => {
    const email = normEmail(member.correo || "");
    if (email && seenEmails.has(email)) {
      throw new Error(`Email duplicado en lista curada: ${email}`);
    }
    if (email) seenEmails.add(email);
    return {
      ...member,
      correo: email,
      collectionMode: inferCollectionMode(member),
      pricing: inferShipping(member),
      billingPeriodMonths: Number(member.billingPeriodMonths || 1),
      subscriptionStatus: member.subscriptionStatus || "ACTIVE",
      cycleNumber: Number(member.cycleNumber || 1),
      cycleStatus: member.cycleStatus || "PENDING",
      paymentStatus: member.paymentStatus || ((member.cycleStatus || "PENDING") === "PAID" ? "APPROVED" : "PENDING"),
      paidAt: member.paidAt ? new Date(member.paidAt) : null,
      renewalDate: member.renewalDate ? new Date(member.renewalDate) : null,
    };
  });
}

function indexWompi(payments) {
  const exactByEmailAmount = new Map();
  const approvedByEmail = new Map();
  for (const p of payments) {
    if (p.estado !== "APROBADA" || !p.email) continue;
    const key = `${p.email}|${p.amountInCents}`;
    if (!exactByEmailAmount.has(key)) exactByEmailAmount.set(key, p);
    if (!approvedByEmail.has(p.email)) approvedByEmail.set(p.email, []);
    approvedByEmail.get(p.email).push(p);
  }
  return { exactByEmailAmount, approvedByEmail };
}

function enrichMembersWithWompi(members, wompiIndex) {
  const mismatches = [];
  const enriched = members.map((member) => {
    if (member.wompiTransactionId || !member.correo) return member;
    const exactKey = `${member.correo}|${member.pricing.totalInCents}`;
    const exact = wompiIndex.exactByEmailAmount.get(exactKey);
    if (exact) {
      return {
        ...member,
        wompiTransactionId: exact.transaccionId || null,
        paidAt: member.paidAt || exact.paidAt || null,
        paymentStatus: member.paymentStatus || "APPROVED",
        cycleStatus: member.cycleStatus === "PENDING" ? "PAID" : member.cycleStatus,
      };
    }
    const candidates = wompiIndex.approvedByEmail.get(member.correo) || [];
    if (candidates.length) {
      mismatches.push({
        nombre: member.nombre,
        correo: member.correo,
        esperado: member.pricing.totalInCents,
        candidatos: candidates.map((p) => ({
          transaccionId: p.transaccionId,
          amountInCents: p.amountInCents,
          paidAt: p.paidAt ? p.paidAt.toISOString() : null,
        })),
      });
    }
    return member;
  });
  return { enriched, mismatches };
}

async function ensurePlans(tenantId) {
  const planMap = new Map();
  for (const def of PLAN_DEFS) {
    let plan = await prisma.subscriptionPlan.findUnique({ where: { name: def.name } });
    const data = {
      tenantId,
      name: def.name,
      priceInCents: def.basePriceInCents,
      currency: "COP",
      intervalUnit: "MONTH",
      intervalCount: 1,
      planType: "auto_subscription",
      active: true,
      metadata: { collectionMode: "MANUAL_LINK", mdvCanonical: true, mdvCategory: def.category, importSource: "migrate-mdv-abril2026-curated" },
    };
    if (!plan) {
      if (!DRY_RUN) {
        plan = await prisma.subscriptionPlan.create({ data });
        await prisma.subscriptionPlanTenant.create({ data: { planId: plan.id, tenantId } }).catch(() => {});
      } else {
        plan = { id: `dry-plan-${def.category.toLowerCase()}`, ...data };
      }
      console.log(`  + Plan ${def.name}`);
    } else {
      if (!DRY_RUN) {
        plan = await prisma.subscriptionPlan.update({
          where: { id: plan.id },
          data: {
            priceInCents: def.basePriceInCents,
            currency: "COP",
            intervalUnit: "MONTH",
            intervalCount: 1,
            active: true,
            metadata: data.metadata,
          },
        });
        await prisma.subscriptionPlanTenant.createMany({ data: [{ planId: plan.id, tenantId }], skipDuplicates: true }).catch(() => {});
      }
      console.log(`  = Plan ${def.name}`);
    }
    planMap.set(def.category, plan);
  }
  return planMap;
}

async function cleanupLegacyPlans({ tenantId, planMap }) {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { tenantId },
    select: { id: true, name: true, active: true, metadata: true },
  });

  const summary = {
    legacyPlansFound: 0,
    subscriptionsMigrated: 0,
    plansDeactivated: 0,
    skipped: [],
  };

  for (const plan of plans) {
    const category = inferCategoryFromPlanName(plan.name);
    if (!category) continue;
    const canonical = planMap.get(category);
    if (!canonical) continue;
    if (plan.id === canonical.id) continue;

    summary.legacyPlansFound += 1;
    console.log(`  legacy → ${plan.name} => ${canonical.name}`);

    if (!DRY_RUN) {
      const moved = await prisma.subscription.updateMany({
        where: { tenantId, planId: plan.id },
        data: { planId: canonical.id },
      });
      summary.subscriptionsMigrated += moved.count;

      await prisma.subscriptionPlan.update({
        where: { id: plan.id },
        data: {
          active: false,
          metadata: {
            ...(plan.metadata && typeof plan.metadata === "object" ? plan.metadata : {}),
            retiredByMigration: "migrate-mdv-abril2026-curated",
            migratedToPlanId: canonical.id,
          },
        },
      });
      summary.plansDeactivated += 1;
    }
  }

  return summary;
}

async function upsertCustomer({ tenantId, member, stats }) {
  const email = member.correo || `sin-correo-mdv-${member.category}-${member.rowNum}@placeholder.apiflujos.com`;
  let customer = await prisma.customer.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (!customer && member.celular) {
    customer = await prisma.customer.findFirst({
      where: { tenantId, name: { equals: member.nombre, mode: "insensitive" } },
    });
  }

  const metadata = {
    identificacion: member.identificacion || null,
    address: { line1: member.direccion || null, city: member.ciudad || null },
    mdv: {
      rowNum: member.rowNum,
      category: member.category,
      curated: true,
      planLabel: member.planLabel,
      billingPeriodMonths: member.billingPeriodMonths,
      requiresShipping: member.pricing.requiresShipping,
    },
    importSource: "migrate-mdv-abril2026-curated",
  };

  if (!customer) {
    if (DRY_RUN) {
      customer = { id: `dry-customer-${member.category}-${member.rowNum}`, email, name: member.nombre, phone: member.celular, metadata };
    } else {
      customer = await prisma.customer.create({
        data: {
          tenantId,
          email,
          name: member.nombre,
          phone: member.celular || null,
          metadata,
        },
      });
      await prisma.customerTenant.createMany({ data: [{ customerId: customer.id, tenantId }], skipDuplicates: true });
    }
    stats.customersCreated += 1;
  } else {
    stats.customersUpdated += 1;
    if (!DRY_RUN) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          name: member.nombre,
          phone: member.celular || customer.phone,
          metadata,
        },
      });
      await prisma.customerTenant.createMany({ data: [{ customerId: customer.id, tenantId }], skipDuplicates: true });
    }
  }

  return customer;
}

async function upsertSubscriptionRecord({ tenantId, member, customer, plan }) {
  let subscription = await prisma.subscription.findFirst({
    where: {
      tenantId,
      customerId: customer.id,
      planId: plan.id,
    },
  });

  const metadata = {
    collectionMode: member.collectionMode,
    billingPeriodMonths: member.billingPeriodMonths,
    pricing: {
      basePriceInCents: member.pricing.basePriceInCents,
      shippingInCents: member.pricing.shippingInCents,
      totalInCents: member.pricing.totalInCents,
      currency: "COP",
    },
    requiresShipping: member.pricing.requiresShipping,
    planLabel: member.planLabel,
    importSource: "migrate-mdv-abril2026-curated",
    ...(member.renewalDate ? { renewalDate: member.renewalDate.toISOString() } : {}),
  };
  const periodEnd = addMonths(APRIL_2026, member.billingPeriodMonths);

  if (!subscription) {
    const id = DRY_RUN ? `dry-sub-${member.category}-${member.rowNum}` : null;
    if (!DRY_RUN) {
      subscription = await prisma.subscription.create({
        data: {
          tenantId,
          customerId: customer.id,
          planId: plan.id,
          status: member.subscriptionStatus,
          startAt: APRIL_2026,
          cycleStartDay: CYCLE_START_DAY,
          paymentDay: PAYMENT_DAY,
          paymentTiming: PAYMENT_TIMING,
          graceDays: GRACE_DAYS,
          metadata,
        },
      });
      await prisma.subscriptionTenant.createMany({
        data: [{ subscriptionId: subscription.id, tenantId }],
        skipDuplicates: true,
      });
    } else {
      subscription = {
        id,
        tenantId,
        customerId: customer.id,
        planId: plan.id,
        status: member.subscriptionStatus,
        metadata,
      };
    }
  } else if (!DRY_RUN) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: plan.id,
        status: member.subscriptionStatus,
        startAt: APRIL_2026,
        cycleStartDay: CYCLE_START_DAY,
        paymentDay: PAYMENT_DAY,
        paymentTiming: PAYMENT_TIMING,
        graceDays: GRACE_DAYS,
        metadata,
      },
    });
    await prisma.subscriptionTenant.createMany({
      data: [{ subscriptionId: subscription.id, tenantId }],
      skipDuplicates: true,
    });
  }

  return { subscription, periodEnd };
}

async function upsertBillingCycle({ subscriptionId, member, dueAt, periodEnd }) {
  const existing = DRY_RUN
    ? null
    : await prisma.subscriptionBillingCycle.findUnique({
        where: { subscriptionId_cycleNumber: { subscriptionId, cycleNumber: member.cycleNumber } },
      });

  if (!existing) {
    if (DRY_RUN) {
      return {
        id: `dry-cycle-${subscriptionId}-${member.cycleNumber}`,
        subscriptionId,
        cycleNumber: member.cycleNumber,
        paymentId: null,
      };
    }
    return prisma.subscriptionBillingCycle.create({
      data: {
        subscriptionId,
        cycleNumber: member.cycleNumber,
        periodStartAt: APRIL_2026,
        periodEndAt: periodEnd,
        dueAt,
        status: member.cycleStatus,
        paidAt: member.paidAt || null,
        paidOnTime: member.cycleStatus === "PAID" ? true : null,
        daysEarly: member.cycleStatus === "PAID" ? 0 : null,
        daysLate: member.cycleStatus === "PAID" ? 0 : null,
        associatedBy: "migration:abril2026-curated",
        associationReason: member.cycleStatus === "PAID" ? "MANUAL_RECONCILE" : null,
      },
    });
  }

  if (!DRY_RUN) {
    return prisma.subscriptionBillingCycle.update({
      where: { id: existing.id },
      data: {
        periodStartAt: APRIL_2026,
        periodEndAt: periodEnd,
        dueAt,
        status: member.cycleStatus,
        paidAt: member.paidAt || null,
        paidOnTime: member.cycleStatus === "PAID" ? true : null,
        daysEarly: member.cycleStatus === "PAID" ? 0 : null,
        daysLate: member.cycleStatus === "PAID" ? 0 : null,
        origin: member.paymentStatus === "APPROVED" ? (member.wompiTransactionId ? "WEBHOOK" : "MANUAL_USER") : null,
        associatedBy: "migration:abril2026-curated",
        associationReason: member.paymentStatus === "APPROVED"
          ? (member.wompiTransactionId ? "TX_MATCH" : "MANUAL_RECONCILE")
          : null,
      },
    });
  }
  return existing;
}

async function detachConflicts(cycleKey, keepPaymentId, cycleId) {
  if (DRY_RUN) return;
  await prisma.payment.updateMany({
    where: {
      subscriptionCycleKey: cycleKey,
      ...(keepPaymentId ? { id: { not: keepPaymentId } } : {}),
    },
    data: { subscriptionCycleKey: null, subscriptionId: null, cycleNumber: null },
  });
  if (cycleId) {
    const cycle = await prisma.subscriptionBillingCycle.findUnique({ where: { id: cycleId }, select: { paymentId: true } });
    if (cycle?.paymentId && cycle.paymentId !== keepPaymentId) {
      await prisma.subscriptionBillingCycle.update({ where: { id: cycleId }, data: { paymentId: null } });
    }
  }
}

async function upsertPayment({ tenantId, member, customerId, subscriptionId, cycleId }) {
  if (!member.paymentStatus) return null;
  const cycleKey = `${subscriptionId}:${member.cycleNumber}`;
  let payment = null;

  if (member.wompiTransactionId && !DRY_RUN) {
    payment = await prisma.payment.findUnique({ where: { wompiTransactionId: member.wompiTransactionId } });
  }
  if (!payment && !DRY_RUN) {
    payment = await prisma.payment.findUnique({ where: { subscriptionCycleKey: cycleKey } });
  }

  const data = {
    tenantId,
    customerId,
    subscriptionId,
    amountInCents: member.pricing.totalInCents,
    currency: "COP",
    cycleNumber: member.cycleNumber,
    reference: `SUB_${subscriptionId}_${member.cycleNumber}`,
    subscriptionCycleKey: cycleKey,
    status: member.paymentStatus,
    paidAt: member.paymentStatus === "APPROVED" ? member.paidAt || new Date("2026-04-01T12:00:00.000Z") : null,
    failedAt: member.paymentStatus === "ERROR" || member.paymentStatus === "DECLINED" ? new Date() : null,
    origin: member.wompiTransactionId ? "WEBHOOK" : "MANUAL_USER",
    associationReason: member.wompiTransactionId ? "TX_MATCH" : "MANUAL_RECONCILE",
    associatedBy: "migration:abril2026-curated",
    providerResponse: member.wompiTransactionId ? { curatedSource: true } : null,
    ...(member.wompiTransactionId ? { wompiTransactionId: member.wompiTransactionId } : {}),
  };

  if (DRY_RUN) {
    return { id: `dry-payment-${subscriptionId}-${member.cycleNumber}`, ...data };
  }

  await detachConflicts(cycleKey, payment?.id || null, cycleId);

  if (!payment) {
    payment = await prisma.payment.create({ data });
  } else {
    payment = await prisma.payment.update({ where: { id: payment.id }, data });
  }

  return payment;
}

async function syncCycleWithPayment({ cycleId, payment, member }) {
  if (DRY_RUN || !cycleId) return;
  await prisma.subscriptionBillingCycle.update({
    where: { id: cycleId },
    data: {
      paymentId: payment ? payment.id : null,
      status: member.cycleStatus,
      paidAt: payment?.paidAt || member.paidAt || null,
      paidOnTime: member.cycleStatus === "PAID" ? true : null,
      daysEarly: member.cycleStatus === "PAID" ? 0 : null,
      daysLate: member.cycleStatus === "PAID" ? 0 : null,
      origin: payment ? payment.origin : null,
      associationReason: payment ? payment.associationReason : null,
      associatedBy: "migration:abril2026-curated",
    },
  });
}

async function processMember({ tenantId, planMap, member, stats }) {
  const plan = planMap.get(member.category);
  if (!plan) throw new Error(`Sin plan para categoría ${member.category}`);

  const customer = await upsertCustomer({ tenantId, member, stats });
  const { subscription, periodEnd } = await upsertSubscriptionRecord({ tenantId, member, customer, plan });
  const dueAt = computeDueAt(APRIL_2026, CYCLE_START_DAY, PAYMENT_DAY, PAYMENT_TIMING);
  const cycle = await upsertBillingCycle({ subscriptionId: subscription.id, member, dueAt, periodEnd });
  const payment = await upsertPayment({
    tenantId,
    member,
    customerId: customer.id,
    subscriptionId: subscription.id,
    cycleId: cycle.id,
  });
  await syncCycleWithPayment({ cycleId: cycle.id, payment, member });

  stats.processed += 1;
  if (payment?.wompiTransactionId) stats.wompiLinked += 1;
  if (member.cycleStatus === "PAID") stats.cyclesPaid += 1;
  else stats.cyclesPending += 1;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Migración MdV - Abril 2026 (curated)");
  console.log(`  Modo: ${DRY_RUN ? "DRY RUN" : "APPLY"}`);
  console.log("═══════════════════════════════════════════════════════════════");

  const members = prepareMembers();
  const wompiPayments = parseWompiXlsx(WOMPI_XLSX);
  const wompiIndex = indexWompi(wompiPayments);
  const { enriched, mismatches } = enrichMembersWithWompi(members, wompiIndex);

  console.log(`Miembros curados: ${enriched.length}`);
  console.log(`Pagos Wompi leídos: ${wompiPayments.length}`);
  console.log(`Candidatos Wompi con mismatch de valor: ${mismatches.length}`);

  await prisma.$connect();
  const tenant = await prisma.saTenant.findFirst({ where: { name: { equals: TENANT_NAME, mode: "insensitive" } } });
  if (!tenant) throw new Error(`Tenant no encontrado: ${TENANT_NAME}`);

  const planMap = await ensurePlans(tenant.id);
  console.log("\n🔄 Limpieza de planes viejos...");
  const cleanupSummary = await cleanupLegacyPlans({ tenantId: tenant.id, planMap });
  const stats = {
    processed: 0,
    customersCreated: 0,
    customersUpdated: 0,
    wompiLinked: 0,
    cyclesPaid: 0,
    cyclesPending: 0,
  };

  for (const member of enriched) {
    console.log(`\n[${member.category}:${member.rowNum}] ${member.nombre}`);
    await processMember({ tenantId: tenant.id, planMap, member, stats });
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  RESUMEN");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`Procesados: ${stats.processed}`);
  console.log(`Clientes creados: ${stats.customersCreated}`);
  console.log(`Clientes actualizados: ${stats.customersUpdated}`);
  console.log(`Planes viejos detectados: ${cleanupSummary.legacyPlansFound}`);
  console.log(`Suscripciones migradas desde planes viejos: ${cleanupSummary.subscriptionsMigrated}`);
  console.log(`Planes viejos desactivados: ${cleanupSummary.plansDeactivated}`);
  console.log(`Ciclos PAID: ${stats.cyclesPaid}`);
  console.log(`Ciclos PENDING: ${stats.cyclesPending}`);
  console.log(`Pagos enlazados a Wompi: ${stats.wompiLinked}`);

  if (mismatches.length) {
    console.log("\n⚠️  MISMATCHES Wompi (email coincide pero el valor no):");
    for (const item of mismatches) {
      console.log(`- ${item.nombre} <${item.correo}> esperado=${item.esperado / 100}`);
      for (const candidate of item.candidatos) {
        console.log(`    tx=${candidate.transaccionId} valor=${candidate.amountInCents / 100} paidAt=${candidate.paidAt || "N/A"}`);
      }
    }
  }

  console.log(`\n${DRY_RUN ? "DRY RUN: sin cambios persistidos" : "✅ Migración curada completada"}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("💥 MIGRACIÓN FALLIDA:", err.message || err);
  if (err.stack) console.error(err.stack);
  try {
    await prisma.$disconnect();
  } catch (_) {
    // no-op
  }
  process.exit(1);
});
