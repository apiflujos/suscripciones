/**
 * ¿Se disparó algo hoy? Responde sin abrir la base a mano.
 *
 *   npm run check:jobs
 *
 * Lee (solo lectura) qué hay agendado, qué quedó atrasado y qué se movió hoy.
 * Si no salió nada, lo que suele fallar es el worker: revisar que el proceso
 * de jobs esté corriendo contra esta misma base.
 */
import { prisma } from "@suscripciones/database";

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function bogota(date) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function startOfTodayBogota(now) {
  const local = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + BOGOTA_OFFSET_MS);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL. Corré con: node --env-file=.env scripts/check-jobs.mjs");
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const desde = startOfTodayBogota(now);

  const [porEstado, atrasados, proximos, hoyPagos, hoyAvisos, hoyJobs, ciclosVencidos, ultimoPago, ultimoAviso] =
    await Promise.all([
      prisma.retryJob.groupBy({ by: ["status", "type"], _count: { _all: true } }),
      prisma.retryJob.count({ where: { status: "PENDING", runAt: { lt: now } } }),
      prisma.retryJob.findMany({
        where: { status: { in: ["PENDING", "RUNNING"] } },
        orderBy: [{ runAt: "asc" }],
        take: 10,
        select: { type: true, status: true, runAt: true, attempts: true, lockedAt: true }
      }),
      prisma.payment.count({ where: { createdAt: { gte: desde } } }),
      prisma.chatwootMessage.count({ where: { createdAt: { gte: desde } } }),
      prisma.retryJob.count({ where: { updatedAt: { gte: desde } } }),
      prisma.subscriptionBillingCycle.count({
        where: { status: { in: ["PENDING", "FAILED"] }, dueAt: { lte: now } }
      }),
      prisma.payment.findFirst({ orderBy: [{ createdAt: "desc" }], select: { createdAt: true, status: true, origin: true } }),
      prisma.chatwootMessage.findFirst({ orderBy: [{ createdAt: "desc" }], select: { createdAt: true, status: true, type: true } })
    ]);

  console.log(`\nAhora: ${bogota(now)} (Bogotá)`);
  console.log(`Hoy cuenta desde: ${bogota(desde)}\n`);

  console.log("MOVIMIENTO DE HOY");
  console.log(`  pagos creados .......... ${hoyPagos}`);
  console.log(`  avisos creados ......... ${hoyAvisos}`);
  console.log(`  jobs tocados ........... ${hoyJobs}`);
  if (hoyJobs === 0) {
    console.log("  ⚠ Ningún job se movió hoy: el worker probablemente no está corriendo.");
  }

  console.log("\nÚLTIMO REGISTRO");
  console.log(`  pago ... ${ultimoPago ? `${bogota(ultimoPago.createdAt)} · ${ultimoPago.status} · ${ultimoPago.origin}` : "ninguno"}`);
  console.log(`  aviso .. ${ultimoAviso ? `${bogota(ultimoAviso.createdAt)} · ${ultimoAviso.status} · ${ultimoAviso.type}` : "ninguno"}`);

  console.log("\nCOLA DE TRABAJOS");
  if (!porEstado.length) console.log("  (vacía)");
  for (const fila of porEstado) {
    console.log(`  ${String(fila.status).padEnd(8)} ${String(fila.type).padEnd(26)} ${fila._count._all}`);
  }
  console.log(`\n  agendados que ya pasaron su hora: ${atrasados}`);
  if (atrasados > 0) {
    console.log("  ⚠ Hay trabajos vencidos sin ejecutar: nadie los está tomando.");
  }

  console.log("\nPRÓXIMOS A EJECUTAR");
  if (!proximos.length) console.log("  (nada agendado)");
  for (const job of proximos) {
    const lock = job.lockedAt ? ` · tomado desde ${bogota(job.lockedAt)}` : "";
    console.log(`  ${bogota(job.runAt)}  ${String(job.status).padEnd(8)} ${String(job.type).padEnd(24)} intentos=${job.attempts}${lock}`);
  }

  console.log(`\nCiclos vencidos sin pagar: ${ciclosVencidos}\n`);
}

main()
  .catch((err) => {
    // Prisma antepone la invocación fallida; lo útil viene después.
    const lineas = String(err?.message || err)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("Invalid `") && !l.startsWith("`"));
    const msg = lineas.slice(-2).join(" ") || "error desconocido";
    console.error(`\nNo se pudo consultar la base: ${msg}`);
    console.error("Si es un túnel SSH, revisá que siga arriba: el puerto local puede escuchar aunque el otro extremo esté caído.\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
