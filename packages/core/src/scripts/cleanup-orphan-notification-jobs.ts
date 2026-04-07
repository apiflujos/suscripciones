#!/usr/bin/env tsx
/**
 * Script para limpiar jobs huérfanos de notificaciones
 * 
 * Elimina jobs SUBSCRIPTION_REMINDER que:
 * - Referencian suscripciones que no existen
 * - Referencian suscripciones canceladas/expiradas
 * - Tienen anchorAt desactualizado (ciclo ya pasó)
 * - No tienen reglas configuradas
 */

import { prisma } from "../db/prisma";
import { getNotificationsConfig } from "../services/notificationsConfig";
import { LogLevel } from "@prisma/client";
import { systemLog } from "../services/systemLog";
import { resolveSubscriptionBillingState } from "../services/billingCycles";

async function main() {
  console.log("🔍 Iniciando limpieza de jobs huérfanos...");

  const now = new Date();
  const cfg = await getNotificationsConfig();
  const subscriptionDueRules = cfg.rules.filter((r: any) => r.enabled && r.trigger === "SUBSCRIPTION_DUE");
  
  console.log(`📋 Reglas SUBSCRIPTION_DUE activas: ${subscriptionDueRules.length}`);

  // 1. Jobs de notificaciones sin reglas configuradas
  let orphanedByRules = 0;
  if (subscriptionDueRules.length === 0) {
    const result = await prisma.retryJob.updateMany({
      where: {
        type: "SUBSCRIPTION_REMINDER",
        status: { in: ["PENDING", "RUNNING"] }
      },
      data: {
        status: "CANCELED",
        lastError: "No rules configured for SUBSCRIPTION_DUE"
      }
    });
    orphanedByRules = result.count;
    console.log(`❌ Jobs cancelados por no haber reglas: ${orphanedByRules}`);
  }

  // 2. Jobs que referencian suscripciones inexistentes
  const allPendingReminderJobs = await prisma.retryJob.findMany({
    where: {
      type: "SUBSCRIPTION_REMINDER",
      status: { in: ["PENDING", "RUNNING"] }
    },
    select: {
      id: true,
      payload: true
    },
    take: 1000
  });

  let orphanedBySubscription = 0;
  for (const job of allPendingReminderJobs) {
    const payload = job.payload as any;
    const subscriptionId = payload?.subscriptionId;
    
    if (!subscriptionId) {
      await prisma.retryJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELED",
          lastError: "No subscriptionId in payload"
        }
      });
      orphanedBySubscription++;
      continue;
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        status: true
      }
    });

    if (!subscription) {
      await prisma.retryJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELED",
          lastError: "Subscription not found"
        }
      });
      orphanedBySubscription++;
      continue;
    }

    // 3. Jobs para suscripciones canceladas/expiradas
    if (["CANCELED", "EXPIRED"].includes(subscription.status)) {
      await prisma.retryJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELED",
          lastError: `Subscription status: ${subscription.status}`
        }
      });
      orphanedBySubscription++;
      continue;
    }

    const billingState = await resolveSubscriptionBillingState({ subscriptionId: subscription.id });
    const collectionCycle = billingState?.collectionCycle || null;
    if (!collectionCycle) {
      await prisma.retryJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELED",
          lastError: "Missing collection cycle"
        }
      });
      orphanedBySubscription++;
      continue;
    }

    // 4. Jobs con ciclo desactualizado
    const payloadCycle = payload?.cycleNumber;
    if (typeof payloadCycle === "number" && collectionCycle.cycleNumber !== payloadCycle) {
      await prisma.retryJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELED",
          lastError: `Cycle mismatch: payload=${payloadCycle}, current=${collectionCycle.cycleNumber}`
        }
      });
      orphanedBySubscription++;
      continue;
    }

    // 5. Jobs con anchorAt desactualizado
    const anchorAt = payload?.anchorAt ? new Date(payload.anchorAt) : null;
    if (anchorAt && new Date(collectionCycle.dueAt || collectionCycle.periodEndAt).toISOString() !== anchorAt.toISOString()) {
      await prisma.retryJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELED",
          lastError: "Anchor date mismatch"
        }
      });
      orphanedBySubscription++;
      continue;
    }
  }

  console.log(`❌ Jobs cancelados por suscripción inválida: ${orphanedBySubscription}`);

  // 6. Jobs muy viejos (más de 7 días)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oldJobsResult = await prisma.retryJob.updateMany({
    where: {
      type: "SUBSCRIPTION_REMINDER",
      status: "PENDING",
      runAt: { lt: weekAgo }
    },
    data: {
      status: "CANCELED",
      lastError: "Job too old"
    }
  });
  console.log(`❌ Jobs cancelados por antiguos: ${oldJobsResult.count}`);

  // Resumen
  const totalCleaned = orphanedByRules + orphanedBySubscription + oldJobsResult.count;
  console.log(`\n✅ Total jobs limpiados: ${totalCleaned}`);

  await systemLog(
    LogLevel.INFO,
    "jobs.cleanup",
    "Limpieza de jobs huérfanos completada",
    {
      orphanedByRules,
      orphanedBySubscription,
      oldJobs: oldJobsResult.count,
      total: totalCleaned,
      executedAt: now.toISOString()
    },
    "script:cleanup-orphan-jobs"
  ).catch(() => {});

  console.log("\n📊 Estado actual de jobs:");
  const [pending, running, failed] = await Promise.all([
    prisma.retryJob.count({ where: { type: "SUBSCRIPTION_REMINDER", status: "PENDING" } }),
    prisma.retryJob.count({ where: { type: "SUBSCRIPTION_REMINDER", status: "RUNNING" } }),
    prisma.retryJob.count({ where: { type: "SUBSCRIPTION_REMINDER", status: "FAILED" } })
  ]);
  console.log(`  - PENDING: ${pending}`);
  console.log(`  - RUNNING: ${running}`);
  console.log(`  - FAILED: ${failed}`);
}

main()
  .catch((err) => {
    console.error("❌ Error:", err?.message || err);
    process.exit(1);
  })
  .then(() => {
    console.log("\n✅ Script completado");
    process.exit(0);
  });
