/**
 * Pre-flight check para día de cobro.
 * Uso: DATABASE_URL="..." npx tsx scripts/preflight-billing-check.ts [--days=1]
 *
 * Por defecto inspecciona suscripciones con dueAt MAÑANA.
 * --days=0 = hoy, --days=1 = mañana (default), --days=2 = pasado mañana
 */

import { prisma } from "@suscripciones/database";
import { RetryJobType, RetryJobStatus, SubscriptionStatus, BillingCycleStatus } from "@prisma/client";
import { getAutoDebitConfig } from "@suscripciones/core/services/runtimeConfig";
import { getNotificationsConfig } from "@suscripciones/core/services/notificationsConfig";
import { extractCustomerPaymentSourceId } from "@suscripciones/core/lib/customerMetadata";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";

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

const daysArg = process.argv.find(a => a.startsWith("--days="));
const offsetDays = daysArg ? parseInt(daysArg.split("=")[1] ?? "1") : 1;

function getDayWindow(offsetDays: number) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

async function main() {
  const { start: dayStart, end: dayEnd } = getDayWindow(offsetDays);
  const label = offsetDays === 0 ? "HOY" : offsetDays === 1 ? "MAÑANA" : `en ${offsetDays} días`;

  console.log(`\n${BOLD}=== PRE-FLIGHT BILLING CHECK — dueAt: ${dayStart.toISOString().slice(0, 10)} (${label}) ===${RESET}`);
  console.log(`${DIM}Ejecutado: ${new Date().toISOString()}${RESET}`);

  // ── A. AUTO-DEBIT CONFIG ──────────────────────────────────────────────────
  console.log(section("A. Configuración auto-débito"));
  let autoDebitOk = false;
  try {
    const cfg = await getAutoDebitConfig();
    const enabledStr = cfg.enabled ? ok("enabled=true") : fail("enabled=false ← BLOQUEO TOTAL");
    const cutoffStr = cfg.chargeAtCutoffEnabled ? ok("chargeAtCutoffEnabled=true") : fail("chargeAtCutoffEnabled=false ← no cobra automático");
    console.log(`  ${enabledStr}`);
    console.log(`  ${cutoffStr}`);
    console.log(`  ${DIM}executionHour=${cfg.executionHour}  timeZone=${cfg.timeZone}  graceDays=${cfg.graceDays}${RESET}`);
    console.log(`  ${DIM}retryEnabled=${cfg.retryEnabled}  maxRetries=${cfg.maxRetries}${RESET}`);
    autoDebitOk = cfg.enabled && cfg.chargeAtCutoffEnabled;
  } catch (e) {
    console.log(`  ${fail("Error leyendo config: " + String(e))}`);
  }

  // ── B. SUSCRIPCIONES CON DUEÁT EN LA FECHA OBJETIVO ──────────────────────
  console.log(section(`B. Suscripciones con dueAt ${label}`));

  const cycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      dueAt: { gte: dayStart, lt: dayEnd },
      status: BillingCycleStatus.PENDING,
      subscription: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
      },
    },
    include: {
      subscription: {
        include: {
          customer: true,
          plan: true,
        },
      },
    },
    orderBy: { dueAt: "asc" },
  });

  console.log(`  Encontradas: ${BOLD}${cycles.length}${RESET} suscripciones con ciclo PENDING`);

  if (!cycles.length) {
    console.log(`  ${warn("No hay ciclos PENDING con dueAt en esta fecha. ¿Es correcta la fecha?")}`);
  }

  const subsIds = cycles.map((c) => c.subscriptionId);

  // Buscar RetryJobs existentes para estas suscripciones
  const existingJobs = subsIds.length
    ? await prisma.retryJob.findMany({
        where: {
          status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] },
          type: { in: [RetryJobType.PAYMENT_RETRY, RetryJobType.SUBSCRIPTION_REMINDER] },
        },
        orderBy: { runAt: "asc" },
      })
    : [];

  const paymentRetryBySub = new Map<string, { runAt: Date }[]>();
  const reminderBySub = new Map<string, { runAt: Date }[]>();

  for (const job of existingJobs) {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const sid = String(payload.subscriptionId || "");
    if (!sid || !subsIds.includes(sid)) continue;
    if (job.type === RetryJobType.PAYMENT_RETRY) {
      if (!paymentRetryBySub.has(sid)) paymentRetryBySub.set(sid, []);
      paymentRetryBySub.get(sid)!.push({ runAt: job.runAt });
    } else if (job.type === RetryJobType.SUBSCRIPTION_REMINDER) {
      if (!reminderBySub.has(sid)) reminderBySub.set(sid, []);
      reminderBySub.get(sid)!.push({ runAt: job.runAt });
    }
  }

  let blockedCount = 0;
  let noAutoDebitCount = 0;
  let missingReminderCount = 0;
  let missingPaymentRetryCount = 0;

  console.log("");

  for (const cycle of cycles) {
    const sub = cycle.subscription;
    const customer = sub.customer;
    const plan = sub.plan;

    const hasEmail = Boolean(customer?.email?.trim());
    const hasToken = extractCustomerPaymentSourceId(customer?.metadata) !== null;
    const mode = resolveSubscriptionCollectionMode({ plan: plan as any, metadata: sub.metadata as any });
    const isAutoDebit = mode === "AUTO_DEBIT";

    const paymentRetryJobs = paymentRetryBySub.get(sub.id) ?? [];
    const reminderJobs = reminderBySub.get(sub.id) ?? [];

    const hasPaymentRetry = paymentRetryJobs.length > 0;
    const hasReminder = reminderJobs.length > 0;

    const dueAtStr = cycle.dueAt.toISOString().slice(11, 16) + "Z";
    const retryStr = hasPaymentRetry
      ? ok(`PAYMENT_RETRY @ ${paymentRetryJobs[0]!.runAt.toISOString().slice(11, 16)}Z`)
      : fail("sin PAYMENT_RETRY job (runner lo crea en <30min)");

    const reminderStr = hasReminder
      ? ok(`${reminderJobs.length} REMINDER(s) @ ${reminderJobs.map((j) => j.runAt.toISOString().slice(11, 16) + "Z").join(", ")}`)
      : warn("sin SUBSCRIPTION_REMINDER jobs");

    let action: string;
    let blocked = false;

    if (!isAutoDebit) {
      action = `${YELLOW}LINK${RESET} (${mode})`;
      noAutoDebitCount++;
    } else if (!hasEmail || !hasToken) {
      action = `${RED}BLOQUEADO${RESET}`;
      blocked = true;
      blockedCount++;
    } else if (!autoDebitOk) {
      action = `${RED}BLOQUEADO${RESET} (config disabled)`;
      blocked = true;
      blockedCount++;
    } else {
      action = `${GREEN}COBRO_AUTO${RESET}`;
    }

    if (!hasReminder) missingReminderCount++;
    if (!hasPaymentRetry) missingPaymentRetryCount++;

    const customerName = String(customer?.name ?? "").slice(0, 25).padEnd(25);
    const modeLabel = mode.padEnd(11);

    console.log(`  ${BOLD}${sub.id.slice(0, 8)}${RESET} ${DIM}[ciclo ${cycle.cycleNumber}, dueAt ${dueAtStr}]${RESET}`);
    console.log(`    cliente : ${customerName}  modo: ${modeLabel}  status: ${sub.status}`);
    console.log(`    email   : ${hasEmail ? ok("sí") : fail("NO ← Wompi lo requiere")}`);
    console.log(`    token   : ${isAutoDebit ? (hasToken ? ok("sí") : fail("NO ← fallback a link")) : DIM + "n/a" + RESET}`);
    console.log(`    cobro   : ${retryStr}`);
    console.log(`    recordat: ${reminderStr}`);
    console.log(`    acción  : ${action}`);
    if (blocked) {
      if (!hasEmail) console.log(`    ${RED}→ Completar email en admin para que Wompi pueda cobrar${RESET}`);
      if (!hasToken && isAutoDebit) console.log(`    ${YELLOW}→ Sin token: se enviará link de pago en su lugar${RESET}`);
    }
    console.log("");
  }

  // ── C. CONFIG DE NOTIFICACIONES ───────────────────────────────────────────
  console.log(section("C. Configuración de notificaciones"));
  try {
    const cfg = await getNotificationsConfig();
    const triggers = ["SUBSCRIPTION_DUE", "PAYMENT_APPROVED", "PAYMENT_DECLINED", "PAYMENT_LINK_CREATED"];
    for (const trigger of triggers) {
      const rules = (cfg.rules ?? []).filter((r: any) => r.trigger === trigger);
      if (!rules.length) {
        console.log(`  ${warn(trigger + ": sin reglas")}`);
        continue;
      }
      for (const rule of rules) {
        const enabledStr = rule.enabled ? ok("ON") : warn("OFF");
        const tpl = (cfg.templates ?? []).find((t: any) => t.id === rule.templateId);
        const tplName = tpl ? ok(`plantilla: "${tpl.name}"`) : fail(`plantilla "${rule.templateId}" NO encontrada`);
        const offsets = rule.offsetsSeconds ?? rule.offsetsMinutes?.map((m: number) => m * 60) ?? [];
        const offsetStr = offsets.length ? `  offsets: ${offsets.map((s: number) => (s >= 0 ? "+" : "") + s + "s").join(", ")}` : "";
        const atTime = rule.atTimeBogota ? `  hora: ${rule.atTimeBogota} Bogotá` : "";
        console.log(`  ${enabledStr} ${trigger.padEnd(22)} ${tplName}${DIM}${offsetStr}${atTime}${RESET}`);
      }
    }
  } catch (e) {
    console.log(`  ${fail("Error leyendo config: " + String(e))}`);
  }

  // ── D. RESUMEN ────────────────────────────────────────────────────────────
  console.log(section("D. Resumen"));
  console.log(`  Total suscripciones con dueAt ${label}: ${BOLD}${cycles.length}${RESET}`);
  if (blockedCount > 0) console.log(`  ${fail(`${blockedCount} BLOQUEADAS (sin email/config disabled)`)}`);
  if (noAutoDebitCount > 0) console.log(`  ${warn(`${noAutoDebitCount} con modo != AUTO_DEBIT (recibirán link)`)}`);
  if (missingPaymentRetryCount > 0) console.log(`  ${warn(`${missingPaymentRetryCount} sin PAYMENT_RETRY job (el runner las crea automáticamente en ≤30 min)`)}`);
  if (missingReminderCount > 0) {
    console.log(`  ${fail(`${missingReminderCount} sin SUBSCRIPTION_REMINDER jobs ← ejecutar reschedule-due-notifications.ts`)}`);
  } else if (cycles.length > 0) {
    console.log(`  ${ok("Todas tienen recordatorios programados")}`);
  }

  if (!autoDebitOk) {
    console.log(`\n  ${RED}${BOLD}⛔ AUTO-DEBIT DESHABILITADO — habilitar en /settings antes de mañana${RESET}`);
  }

  console.log(`\n  ${DIM}Worker Docker: docker compose logs jobs --tail=30${RESET}`);
  console.log(`  ${DIM}Reintentar FAILED: POST /admin/logs/jobs/retry-failed${RESET}`);
  if (missingReminderCount > 0) {
    console.log(`  ${YELLOW}  → Recordatorios faltantes: DATABASE_URL="..." npx tsx scripts/reschedule-due-notifications.ts${RESET}`);
  }
  console.log("");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
