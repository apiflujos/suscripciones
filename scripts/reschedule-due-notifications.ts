/**
 * Reprograma SUBSCRIPTION_REMINDER jobs para suscripciones próximas a cobrar.
 * Uso: DATABASE_URL="..." npx tsx scripts/reschedule-due-notifications.ts [--days=1] [--all]
 *
 * --days=1   (default) → suscripciones con dueAt mañana
 * --days=0             → suscripciones con dueAt hoy
 * --all                → TODAS las suscripciones ACTIVE/PAST_DUE (ignora --days)
 * --dry-run            → muestra qué se haría sin ejecutar
 */

import { prisma } from "@suscripciones/database";
import { SubscriptionStatus, BillingCycleStatus, RetryJobType, RetryJobStatus } from "@prisma/client";
import { scheduleSubscriptionDueNotifications } from "@suscripciones/core/services/notificationsScheduler";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const offsetDays = daysArg ? parseInt(daysArg.split("=")[1] ?? "1") : 1;
const doAll = args.includes("--all");
const dryRun = args.includes("--dry-run");

function getDayWindow(offsetDays: number) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

async function main() {
  const modeLabel = doAll ? "TODAS las suscripciones activas" : `dueAt en ${offsetDays === 1 ? "mañana" : offsetDays === 0 ? "hoy" : offsetDays + " días"}`;
  console.log(`\n${BOLD}=== RESCHEDULE DUE NOTIFICATIONS — ${modeLabel} ===${RESET}`);
  if (dryRun) console.log(`${YELLOW}[DRY RUN] No se ejecutará ningún cambio${RESET}`);
  console.log(`${DIM}Ejecutado: ${new Date().toISOString()}${RESET}\n`);

  let subsIds: string[];

  if (doAll) {
    const subs = await prisma.subscription.findMany({
      where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      select: { id: true },
    });
    subsIds = subs.map((s) => s.id);
    console.log(`Suscripciones ACTIVE/PAST_DUE encontradas: ${BOLD}${subsIds.length}${RESET}`);
  } else {
    const { start, end } = getDayWindow(offsetDays);
    const cycles = await prisma.subscriptionBillingCycle.findMany({
      where: {
        dueAt: { gte: start, lt: end },
        status: BillingCycleStatus.PENDING,
        subscription: {
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        },
      },
      select: { subscriptionId: true },
    });
    subsIds = [...new Set(cycles.map((c) => c.subscriptionId))];
    console.log(`Suscripciones con ciclo PENDING en la fecha objetivo: ${BOLD}${subsIds.length}${RESET}`);
  }

  if (!subsIds.length) {
    console.log(`${YELLOW}No hay suscripciones para reprogramar.${RESET}\n`);
    await prisma.$disconnect();
    return;
  }

  // Filtrar las que YA tienen SUBSCRIPTION_REMINDER pendiente
  const existingReminders = await prisma.retryJob.findMany({
    where: {
      type: RetryJobType.SUBSCRIPTION_REMINDER,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
    },
    select: { payload: true },
  });

  const subsWithReminder = new Set<string>();
  for (const job of existingReminders) {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const sid = String(payload.subscriptionId || "");
    if (sid) subsWithReminder.add(sid);
  }

  const toSchedule = doAll ? subsIds : subsIds.filter((id) => !subsWithReminder.has(id));
  const alreadyOk = subsIds.length - toSchedule.length;

  if (alreadyOk > 0) {
    console.log(`  ${GREEN}✓${RESET} ${alreadyOk} ya tienen recordatorios pendientes → se omiten`);
  }
  console.log(`  Pendientes de programar: ${BOLD}${toSchedule.length}${RESET}\n`);

  if (!toSchedule.length) {
    console.log(`${GREEN}Todo en orden — no hay gaps de recordatorios.${RESET}\n`);
    await prisma.$disconnect();
    return;
  }

  let scheduled = 0;
  let errors = 0;

  for (const subscriptionId of toSchedule) {
    if (dryRun) {
      console.log(`  ${DIM}[DRY] ${subscriptionId}${RESET}`);
      scheduled++;
      continue;
    }
    try {
      const result = await scheduleSubscriptionDueNotifications({
        subscriptionId,
        actor: "preflight-reschedule",
      });
      const count = result.scheduled + result.sentNow;
      if (count > 0) {
        console.log(`  ${GREEN}✓${RESET} ${subscriptionId.slice(0, 8)} → ${count} job(s) programados`);
      } else {
        console.log(`  ${YELLOW}⚠${RESET} ${subscriptionId.slice(0, 8)} → 0 jobs (sin reglas activas o ya pagado)`);
      }
      scheduled++;
    } catch (e) {
      console.log(`  ${RED}✗${RESET} ${subscriptionId.slice(0, 8)} → ERROR: ${String(e)}`);
      errors++;
    }
  }

  console.log(`\n${BOLD}Resultado:${RESET}`);
  console.log(`  Procesadas: ${scheduled}`);
  if (errors > 0) console.log(`  ${RED}Errores: ${errors}${RESET}`);
  console.log(`\n${DIM}Verificar con: DATABASE_URL="..." npx tsx scripts/preflight-billing-check.ts${RESET}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
