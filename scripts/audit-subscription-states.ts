/**
 * Auditoría de consistencia entre estado de suscripciones y ciclos de facturación.
 * Uso: DATABASE_URL="..." npx tsx scripts/audit-subscription-states.ts
 *
 * Detecta suscripciones cuyo status (ACTIVE/PAST_DUE) no coincide con lo que
 * dictan sus ciclos de cobro reales.
 */

import { prisma } from "@suscripciones/database";
import { SubscriptionStatus } from "@prisma/client";
import {
  buildSubscriptionBillingStateIndex,
  isBillingCyclePaid,
  resolveCollectionDelinquency,
} from "@suscripciones/core/services/billingCycles";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { getAutoDebitConfig } from "@suscripciones/core/services/runtimeConfig";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function ok(s: string) { return `${GREEN}✓${RESET} ${s}`; }
function fail(s: string) { return `${RED}✗${RESET} ${s}`; }
function warn(s: string) { return `${YELLOW}⚠${RESET} ${s}`; }
function section(s: string) { return `\n${BOLD}${CYAN}── ${s} ──${RESET}`; }

async function main() {
  const now = new Date();
  console.log(`\n${BOLD}=== AUDITORÍA DE ESTADOS DE SUSCRIPCIONES ===${RESET}`);
  console.log(`${DIM}Ejecutado: ${now.toISOString()}${RESET}\n`);

  const cfg = await getAutoDebitConfig();
  const graceDays = cfg.graceDays ?? 1;
  console.log(`Config: graceDays=${graceDays}  executionHour=${cfg.executionHour}  tz=${cfg.timeZone}\n`);

  // Cargar todas las suscripciones activas/en mora (excluyendo terminadas)
  const subs = await prisma.subscription.findMany({
    where: {
      status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED] },
    },
    include: {
      customer: { select: { name: true, email: true } },
      plan: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Suscripciones cargadas: ${BOLD}${subs.length}${RESET} (ACTIVE + PAST_DUE + SUSPENDED)\n`);

  if (!subs.length) {
    console.log("Sin suscripciones para auditar.");
    await prisma.$disconnect();
    return;
  }

  // Construir el billing state index para todas
  const seeds = subs.map((s) => ({
    id: s.id,
    startAt: s.startAt,
    cycleStartDay: s.cycleStartDay,
    paymentDay: s.paymentDay,
    paymentTiming: s.paymentTiming === "ANTICIPADO" ? "ANTICIPADO" as const : "EN_CURSO" as const,
    graceDays,
    plan: {
      intervalUnit: s.plan.intervalUnit,
      intervalCount: s.plan.intervalCount,
    },
    metadata: s.metadata,
  }));

  const billingIndex = await buildSubscriptionBillingStateIndex({
    subscriptions: seeds,
    asOf: now,
    ensureCycles: false, // solo leer, no crear ciclos
  });

  // Analizar cada suscripción
  let ok_count = 0;
  let mismatch_count = 0;
  let noCollectionCycle = 0;
  let alDia_count = 0;
  let enGracia_count = 0;
  let enMora_count = 0;

  const mismatches: string[] = [];
  const warnings: string[] = [];

  for (const sub of subs) {
    const state = billingIndex.get(sub.id);
    const collectionCycle = state?.collectionCycle ?? null;
    const activeCycle = state?.activeCycle ?? null;
    const oldestUnpaid = state?.oldestUnpaidCycle ?? null;
    const mode = resolveSubscriptionCollectionMode({ plan: sub.plan as any, metadata: sub.metadata as any });

    // La delinquencia real se mide por el ciclo más antiguo sin pagar,
    // no por el collectionCycle (que puede ser un ciclo futuro aún no vencido).
    const delinquency = resolveCollectionDelinquency({
      cycle: oldestUnpaid ?? collectionCycle,
      graceDays,
      asOf: now,
      fallbackSubscriptionStatus: sub.status,
    });

    const { status: dlqStatus, daysPastDue, dueAt } = delinquency;

    // Determinar el estado ESPERADO según la delinquency
    let expectedStatus: "ACTIVE" | "PAST_DUE";
    if (dlqStatus === "AL_DIA") {
      expectedStatus = "ACTIVE";
      alDia_count++;
    } else if (dlqStatus === "EN_GRACIA") {
      expectedStatus = "ACTIVE"; // aún en gracia → se mantiene ACTIVE
      enGracia_count++;
    } else {
      expectedStatus = "PAST_DUE";
      enMora_count++;
    }

    const actualStatus = sub.status;
    const cyclePaid = isBillingCyclePaid(collectionCycle);

    if (!collectionCycle) {
      noCollectionCycle++;
    }

    const statusMatch = actualStatus === expectedStatus ||
      (actualStatus === "SUSPENDED" && expectedStatus === "PAST_DUE"); // SUSPENDED es aceptable si está en mora

    const dueStr = dueAt ? dueAt.toISOString().slice(0, 10) : "n/a";
    const cycleStr = collectionCycle
      ? `ciclo ${collectionCycle.cycleNumber} dueAt=${dueStr} ${cyclePaid ? "PAGADO" : "PENDIENTE"}`
      : activeCycle
        ? `(activeCycle=${activeCycle.cycleNumber}, sin collectionCycle)`
        : "sin ciclos";

    if (statusMatch && dlqStatus === "AL_DIA") {
      ok_count++;
      // Solo mostrar resumen de los OK
    } else if (!statusMatch) {
      mismatch_count++;
      const line = `${RED}✗ MISMATCH${RESET} ${sub.id.slice(0, 8)} "${sub.customer?.name?.slice(0, 28)}" modo=${mode}\n` +
        `    actual=${BOLD}${actualStatus}${RESET}  esperado=${BOLD}${expectedStatus}${RESET}  delinquency=${dlqStatus}\n` +
        `    ${cycleStr}  daysPastDue=${daysPastDue}  graceDays=${graceDays}`;
      mismatches.push(line);
    } else if (statusMatch && dlqStatus !== "AL_DIA") {
      // Estado correcto pero en mora/gracia → es informativo
      const emoji = dlqStatus === "EN_GRACIA" ? "⏳" : "⚠";
      const line = `${YELLOW}${emoji} ${actualStatus}${RESET} ${sub.id.slice(0, 8)} "${sub.customer?.name?.slice(0, 28)}" — ${dlqStatus} ${daysPastDue}d  ${cycleStr}`;
      warnings.push(line);
      ok_count++;
    } else {
      ok_count++;
    }
  }

  // ── MISMATCHES ────────────────────────────────────────────────────────────
  if (mismatches.length) {
    console.log(section(`INCONSISTENCIAS DE ESTADO (${mismatches.length})`));
    console.log(`${DIM}Suscripciones donde el status en BD no coincide con los ciclos de cobro:${RESET}\n`);
    mismatches.forEach((m) => console.log(m + "\n"));
  }

  // ── EN MORA / EN GRACIA ────────────────────────────────────────────────────
  if (warnings.length) {
    console.log(section(`EN MORA O GRACIA — ESTADO CORRECTO (${warnings.length})`));
    console.log(`${DIM}Estado coincide pero la suscripción está atrasada en el pago:${RESET}\n`);
    warnings.forEach((w) => console.log("  " + w));
    console.log("");
  }

  // ── RESUMEN ────────────────────────────────────────────────────────────────
  console.log(section("RESUMEN"));
  console.log(`  Total auditadas  : ${BOLD}${subs.length}${RESET}`);
  console.log(`  ${ok("AL_DÍA (estado correcto)")}: ${alDia_count}`);
  if (enGracia_count) console.log(`  ${warn("EN_GRACIA (dentro de gracia)")}: ${enGracia_count}`);
  if (enMora_count) console.log(`  ${warn("EN_MORA")}: ${enMora_count}`);
  if (noCollectionCycle) console.log(`  ${warn("Sin collectionCycle calculado")}: ${noCollectionCycle}`);
  console.log("");

  if (!mismatch_count) {
    console.log(`  ${GREEN}${BOLD}✓ Sin inconsistencias — todos los estados coinciden con los ciclos${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}✗ ${mismatch_count} inconsistencias detectadas${RESET}`);
    console.log(`  ${DIM}Para corregir: reconcileApprovedPaymentWithSubscription o ajustar status manualmente${RESET}`);
  }
  console.log("");

  // ── DISTRIBUCIÓN POR CICLO ─────────────────────────────────────────────────
  console.log(section("DISTRIBUCIÓN DE CICLOS DE COBRO"));
  // Ciclos con dueAt en los próximos 7 días
  const next7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingCycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      status: "PENDING",
      dueAt: { gte: now, lte: next7 },
      subscription: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
    },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true, subscriptionId: true, cycleNumber: true },
  });

  if (!upcomingCycles.length) {
    console.log(`  Sin ciclos PENDING con dueAt en los próximos 7 días\n`);
  } else {
    // Agrupar por día
    const byDay = new Map<string, number>();
    for (const c of upcomingCycles) {
      const day = c.dueAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    console.log(`  Ciclos PENDING próximos 7 días:`);
    const todayStr = now.toISOString().slice(0, 10);
    const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
    for (const [day, count] of [...byDay.entries()].sort()) {
      const label = day === todayStr ? " ← HOY" : day === tomorrowStr ? " ← MAÑANA" : "";
      const bar = "█".repeat(Math.min(count, 30));
      console.log(`    ${day}${BOLD}${label}${RESET}  ${CYAN}${bar}${RESET} ${count}`);
    }
    console.log("");
  }

  // Ciclos vencidos sin pagar (PENDING + dueAt pasado)
  const overdue = await prisma.subscriptionBillingCycle.count({
    where: {
      status: "PENDING",
      dueAt: { lt: now },
      subscription: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
    },
  });

  if (overdue > 0) {
    console.log(`  ${warn(`${overdue} ciclos PENDING con dueAt en el pasado (en mora)`)} — se cobrarán en el siguiente intento del runner`);
  } else {
    console.log(`  ${ok("Sin ciclos vencidos sin cobrar")}`);
  }

  console.log("");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
