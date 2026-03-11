#!/usr/bin/env tsx
/**
 * Script de Limpieza de Base de Datos
 * 
 * Elimina:
 * - Pagos huérfanos (sin suscripción y no son links de pago válidos)
 * - Contactos huérfanos (sin pagos ni suscripciones)
 * - Jobs huérfanos de notificaciones
 * - Mensajes Chatwoot huérfanos
 * - Webhooks procesados antiguos
 */

import { prisma } from "../db/prisma";
import { PaymentStatus, RetryJobStatus, RetryJobType } from "@prisma/client";
import { systemLog } from "../services/systemLog";
import { LogLevel } from "@prisma/client";

type CleanupStats = {
  // Pagos
  pagosHuérfanos: {
    escaneados: number;
    eliminados: number;
    conservados: number;
    razones: Record<string, number>;
  };
  
  // Contactos
  contactosHuérfanos: {
    escaneados: number;
    eliminados: number;
    conservados: number;
  };
  
  // Jobs
  jobsHuérfanos: {
    escaneados: number;
    eliminados: number;
    porTipo: Record<string, number>;
  };
  
  // Mensajes Chatwoot
  mensajesHuérfanos: {
    escaneados: number;
    eliminados: number;
  };
  
  // Webhooks
  webhooksAntiguos: {
    escaneados: number;
    eliminados: number;
  };
};

async function cleanupOrphanPayments(dryRun: boolean, daysOld: number): Promise<CleanupStats["pagosHuérfanos"]> {
  console.log("\n📊 Limpiando pagos huérfanos...");
  
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  // Buscar pagos sin suscripción
  const orphanPayments = await prisma.payment.findMany({
    where: {
      subscriptionId: null,
      createdAt: { lt: cutoffDate },
      wompiPaymentLinkId: { not: null }  // Que tenga link (pagos de orders/cart)
    },
    select: {
      id: true,
      customerId: true,
      amountInCents: true,
      status: true,
      wompiTransactionId: true,
      wompiPaymentLinkId: true,
      createdAt: true,
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          _count: {
            select: {
              payments: true,
              subscriptions: true
            }
          }
        }
      }
    },
    take: 1000
  });
  
  console.log(`  Encontrados ${orphanPayments.length} pagos sin suscripción`);
  
  const toDelete: string[] = [];
  const toKeep: string[] = [];
  const razones: Record<string, number> = {};
  
  for (const payment of orphanPayments) {
    const customer = payment.customer;
    
    // Conservar si el cliente tiene suscripciones activas
    if (customer._count.subscriptions > 0) {
      toKeep.push(payment.id);
      razones["cliente_tiene_suscripciones"] = (razones["cliente_tiene_suscripciones"] || 0) + 1;
      continue;
    }
    
    // Conservar si el cliente tiene otros pagos recientes
    if (customer._count.payments > 1) {
      toKeep.push(payment.id);
      razones["cliente_tiene_otros_pagos"] = (razones["cliente_tiene_otros_pagos"] || 0) + 1;
      continue;
    }
    
    // Conservar si está aprobado (ya se pagó)
    if (payment.status === PaymentStatus.APPROVED) {
      toKeep.push(payment.id);
      razones["pago_aprobado_historico"] = (razones["pago_aprobado_historico"] || 0) + 1;
      continue;
    }
    
    // Conservar si tiene transacción de Wompi (ya se procesó)
    if (payment.wompiTransactionId) {
      toKeep.push(payment.id);
      razones["tiene_transaccion_wompi"] = (razones["tiene_transaccion_wompi"] || 0) + 1;
      continue;
    }
    
    // Eliminar: pago huérfano pendiente/declinado sin transacción
    toDelete.push(payment.id);
  }
  
  console.log(`  Para eliminar: ${toDelete.length}`);
  console.log(`  Para conservar: ${toKeep.length}`);
  
  if (!dryRun && toDelete.length > 0) {
    // Eliminar en lotes de 100
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      await prisma.payment.deleteMany({
        where: { id: { in: batch } }
      });
    }
    
    console.log(`  ✅ Eliminados ${toDelete.length} pagos huérfanos`);
  }
  
  return {
    escaneados: orphanPayments.length,
    eliminados: dryRun ? 0 : toDelete.length,
    conservados: toKeep.length,
    razones
  };
}

async function cleanupOrphanCustomers(dryRun: boolean): Promise<CleanupStats["contactosHuérfanos"]> {
  console.log("\n👥 Limpiando contactos huérfanos...");
  
  // Buscar contactos sin pagos ni suscripciones
  const orphanCustomers = await prisma.customer.findMany({
    where: {
      subscriptions: { none: {} },
      payments: { none: {} }
    },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      createdAt: true,
      _count: {
        select: {
          chatwootMsgs: true,
          campaignSends: true,
          smartListMembers: true
        }
      }
    },
    take: 1000
  });
  
  console.log(`  Encontrados ${orphanCustomers.length} contactos sin pagos ni suscripciones`);
  
  const toDelete: string[] = [];
  const toKeep: string[] = [];
  
  for (const customer of orphanCustomers) {
    // Conservar si tiene mensajes Chatwoot
    if (customer._count.chatwootMsgs > 0) {
      toKeep.push(customer.id);
      continue;
    }
    
    // Conservar si está en campañas
    if (customer._count.campaignSends > 0) {
      toKeep.push(customer.id);
      continue;
    }
    
    // Conservar si está en smart lists
    if (customer._count.smartListMembers > 0) {
      toKeep.push(customer.id);
      continue;
    }
    
    // Conservar si tiene email (podría ser lead válido)
    if (customer.email) {
      toKeep.push(customer.id);
      continue;
    }
    
    // Eliminar: contacto completamente huérfano
    toDelete.push(customer.id);
  }
  
  console.log(`  Para eliminar: ${toDelete.length}`);
  console.log(`  Para conservar: ${toKeep.length}`);
  
  if (!dryRun && toDelete.length > 0) {
    // Eliminar en lotes de 100
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      
      // Primero eliminar membresías huérfanas
      await prisma.smartListMember.deleteMany({
        where: { customerId: { in: batch } }
      });
      
      // Luego eliminar el contacto
      await prisma.customer.deleteMany({
        where: { id: { in: batch } }
      });
    }
    
    console.log(`  ✅ Eliminados ${toDelete.length} contactos huérfanos`);
  }
  
  return {
    escaneados: orphanCustomers.length,
    eliminados: dryRun ? 0 : toDelete.length,
    conservados: toKeep.length
  };
}

async function cleanupOrphanJobs(dryRun: boolean): Promise<CleanupStats["jobsHuérfanos"]> {
  console.log("\n📋 Limpiando jobs huérfanos...");
  
  const stats = {
    escaneados: 0,
    eliminados: 0,
    porTipo: {} as Record<string, number>
  };
  
  // Jobs de notificaciones para suscripciones que no existen
  const orphanReminderJobs = await prisma.retryJob.findMany({
    where: {
      type: RetryJobType.SUBSCRIPTION_REMINDER,
      status: { in: [RetryJobStatus.PENDING, RetryJobStatus.RUNNING] }
    },
    select: {
      id: true,
      type: true,
      payload: true
    },
    take: 1000
  });
  
  stats.escaneados += orphanReminderJobs.length;
  
  const toDelete: string[] = [];
  
  for (const job of orphanReminderJobs) {
    const payload: any = job.payload;
    const subscriptionId = payload?.subscriptionId;
    
    if (!subscriptionId) {
      toDelete.push(job.id);
      continue;
    }
    
    // Verificar si la suscripción existe
    const subExists = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true }
    });
    
    if (!subExists) {
      toDelete.push(job.id);
    }
  }
  
  // Jobs fallidos antiguos (> 7 días)
  const oldFailedJobs = await prisma.retryJob.findMany({
    where: {
      status: RetryJobStatus.FAILED,
      updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    select: { id: true, type: true },
    take: 1000
  });
  
  stats.escaneados += oldFailedJobs.length;
  toDelete.push(...oldFailedJobs.map(j => j.id));
  
  console.log(`  Para eliminar: ${toDelete.length} jobs huérfanos`);
  
  if (!dryRun && toDelete.length > 0) {
    // Contar por tipo
    for (const job of [...orphanReminderJobs, ...oldFailedJobs]) {
      if (toDelete.includes(job.id)) {
        stats.porTipo[job.type] = (stats.porTipo[job.type] || 0) + 1;
      }
    }
    
    await prisma.retryJob.deleteMany({
      where: { id: { in: toDelete } }
    });
    
    stats.eliminados = toDelete.length;
    console.log(`  ✅ Eliminados ${stats.eliminados} jobs huérfanos`);
  }
  
  return stats;
}

async function cleanupOrphanChatwootMessages(dryRun: boolean): Promise<CleanupStats["mensajesHuérfanos"]> {
  console.log("\n💬 Limpiando mensajes Chatwoot huérfanos...");
  
  const orphanMessages = await prisma.chatwootMessage.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    select: {
      id: true,
      customerId: true,
      subscriptionId: true,
      paymentId: true
    },
    take: 1000
  });
  
  const toDelete: string[] = [];
  
  for (const msg of orphanMessages) {
    // Si no tiene customer, subscription, ni payment → huérfano
    if (!msg.customerId && !msg.subscriptionId && !msg.paymentId) {
      toDelete.push(msg.id);
      continue;
    }
    
    // Verificar si el customer existe
    if (msg.customerId) {
      const customerExists = await prisma.customer.findUnique({
        where: { id: msg.customerId },
        select: { id: true }
      });
      
      if (!customerExists) {
        toDelete.push(msg.id);
      }
    }
  }
  
  console.log(`  Para eliminar: ${toDelete.length} mensajes huérfanos`);
  
  if (!dryRun && toDelete.length > 0) {
    await prisma.chatwootMessage.deleteMany({
      where: { id: { in: toDelete } }
    });
    
    console.log(`  ✅ Eliminados ${toDelete.length} mensajes huérfanos`);
  }
  
  return {
    escaneados: orphanMessages.length,
    eliminados: dryRun ? 0 : toDelete.length
  };
}

async function cleanupOldWebhooks(dryRun: boolean): Promise<CleanupStats["webhooksAntiguos"]> {
  console.log("\n📡 Limpiando webhooks antiguos...");
  
  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 días
  
  const oldWebhooks = await prisma.webhookEvent.count({
    where: {
      receivedAt: { lt: cutoffDate },
      processStatus: { in: ["PROCESSED", "SKIPPED"] }
    }
  });
  
  console.log(`  Para eliminar: ${oldWebhooks} webhooks antiguos procesados`);
  
  if (!dryRun && oldWebhooks > 0) {
    await prisma.webhookEvent.deleteMany({
      where: {
        receivedAt: { lt: cutoffDate },
        processStatus: { in: ["PROCESSED", "SKIPPED"] }
      }
    });
    
    console.log(`  ✅ Eliminados ${oldWebhooks} webhooks antiguos`);
  }
  
  return {
    escaneados: oldWebhooks,
    eliminados: dryRun ? 0 : oldWebhooks
  };
}

async function main() {
  console.log("🧹 Iniciando limpieza de base de datos...\n");
  
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const daysOld = parseInt(args.find(a => a.startsWith("--days="))?.split("=")[1] || "30");
  
  if (dryRun) {
    console.log("⚠️  MODO DRY-RUN: No se eliminará nada\n");
  }
  
  const stats: CleanupStats = {
    pagosHuérfanos: { escaneados: 0, eliminados: 0, conservados: 0, razones: {} },
    contactosHuérfanos: { escaneados: 0, eliminados: 0, conservados: 0 },
    jobsHuérfanos: { escaneados: 0, eliminados: 0, porTipo: {} },
    mensajesHuérfanos: { escaneados: 0, eliminados: 0 },
    webhooksAntiguos: { escaneados: 0, eliminados: 0 }
  };
  
  try {
    stats.pagosHuérfanos = await cleanupOrphanPayments(dryRun, daysOld);
    stats.contactosHuérfanos = await cleanupOrphanCustomers(dryRun);
    stats.jobsHuérfanos = await cleanupOrphanJobs(dryRun);
    stats.mensajesHuérfanos = await cleanupOrphanChatwootMessages(dryRun);
    stats.webhooksAntiguos = await cleanupOldWebhooks(dryRun);
    
    console.log("\n📊 RESUMEN:");
    console.log("═══════════════════════════════════════");
    console.log(`Pagos huérfanos:`);
    console.log(`  - Escaneados: ${stats.pagosHuérfanos.escaneados}`);
    console.log(`  - Eliminados: ${stats.pagosHuérfanos.eliminados}`);
    console.log(`  - Conservados: ${stats.pagosHuérfanos.conservados}`);
    if (Object.keys(stats.pagosHuérfanos.razones).length > 0) {
      console.log(`  - Razones:`);
      for (const [razon, count] of Object.entries(stats.pagosHuérfanos.razones)) {
        console.log(`    • ${razon}: ${count}`);
      }
    }
    
    console.log(`\nContactos huérfanos:`);
    console.log(`  - Escaneados: ${stats.contactosHuérfanos.escaneados}`);
    console.log(`  - Eliminados: ${stats.contactosHuérfanos.eliminados}`);
    console.log(`  - Conservados: ${stats.contactosHuérfanos.conservados}`);
    
    console.log(`\nJobs huérfanos:`);
    console.log(`  - Escaneados: ${stats.jobsHuérfanos.escaneados}`);
    console.log(`  - Eliminados: ${stats.jobsHuérfanos.eliminados}`);
    if (Object.keys(stats.jobsHuérfanos.porTipo).length > 0) {
      console.log(`  - Por tipo:`);
      for (const [tipo, count] of Object.entries(stats.jobsHuérfanos.porTipo)) {
        console.log(`    • ${tipo}: ${count}`);
      }
    }
    
    console.log(`\nMensajes Chatwoot huérfanos:`);
    console.log(`  - Escaneados: ${stats.mensajesHuérfanos.escaneados}`);
    console.log(`  - Eliminados: ${stats.mensajesHuérfanos.eliminados}`);
    
    console.log(`\nWebhooks antiguos:`);
    console.log(`  - Escaneados: ${stats.webhooksAntiguos.escaneados}`);
    console.log(`  - Eliminados: ${stats.webhooksAntiguos.eliminados}`);
    
    const totalEliminados = 
      stats.pagosHuérfanos.eliminados +
      stats.contactosHuérfanos.eliminados +
      stats.jobsHuérfanos.eliminados +
      stats.mensajesHuérfanos.eliminados +
      stats.webhooksAntiguos.eliminados;
    
    console.log("\n═══════════════════════════════════════");
    console.log(`🎯 TOTAL ELIMINADO: ${totalEliminados} registros`);
    
    // Log en sistema
    await systemLog(
      LogLevel.INFO,
      "database.cleanup",
      "Limpieza de base de datos completada",
      {
        dryRun,
        daysOld,
        ...stats
      },
      "script:database-cleanup"
    ).catch(() => {});
    
  } catch (err: any) {
    console.error("\n❌ Error durante la limpieza:", err?.message || err);
    process.exit(1);
  }
  
  console.log("\n✅ Limpieza completada");
  process.exit(0);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
