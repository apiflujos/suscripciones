#!/usr/bin/env tsx
/**
 * Script para cancelar jobs duplicados de notificaciones (SUBSCRIPTION_REMINDER)
 * Duplica si tiene mismo subscriptionId + ruleId + offsetSeconds + cycleNumber + anchorAt
 */

import { prisma } from "../db/prisma";
import { LogLevel } from "@prisma/client";
import { systemLog } from "../services/systemLog";

function keyFromPayload(payload: any) {
  const subscriptionId = String(payload?.subscriptionId || "").trim();
  const ruleId = String(payload?.ruleId || "").trim();
  const offsetSeconds = String(payload?.offsetSeconds ?? "").trim();
  const cycleNumber = String(payload?.cycleNumber ?? "").trim();
  const anchorAt = String(payload?.anchorAt || "").trim();
  return [subscriptionId, ruleId, offsetSeconds, cycleNumber, anchorAt].join("|");
}

async function main() {
  console.log("🧹 Buscando duplicados de SUBSCRIPTION_REMINDER...");

  const jobs = await prisma.retryJob.findMany({
    where: { type: "SUBSCRIPTION_REMINDER", status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true, payload: true, runAt: true, status: true, createdAt: true },
    take: 5000
  });

  const buckets = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = keyFromPayload(job.payload as any);
    if (!key || key.startsWith("||||")) continue;
    const list = buckets.get(key) || [];
    list.push(job);
    buckets.set(key, list);
  }

  let canceled = 0;
  for (const [, list] of buckets) {
    if (list.length <= 1) continue;
    // mantener el job con runAt más cercano (más pronto)
    const sorted = [...list].sort((a, b) => {
      const aTime = a.runAt?.getTime?.() || 0;
      const bTime = b.runAt?.getTime?.() || 0;
      if (aTime !== bTime) return aTime - bTime;
      return (a.createdAt?.getTime?.() || 0) - (b.createdAt?.getTime?.() || 0);
    });
    const keep = sorted[0];
    const toCancel = sorted.slice(1);
    for (const job of toCancel) {
      await prisma.retryJob.update({
        where: { id: job.id },
        data: { status: "CANCELED", lastError: "dedupe_duplicate_reminder" }
      });
      canceled++;
    }
  }

  console.log(`✅ Duplicados cancelados: ${canceled}`);

  await systemLog(
    LogLevel.INFO,
    "jobs.cleanup",
    "Limpieza de duplicados de notificaciones",
    { canceled, scanned: jobs.length, executedAt: new Date().toISOString() },
    "script:cleanup-duplicate-notification-jobs"
  ).catch(() => {});
}

main()
  .catch((err) => {
    console.error("❌ Error:", err?.message || err);
    process.exit(1);
  })
  .then(() => {
    console.log("✅ Script completado");
    process.exit(0);
  });
