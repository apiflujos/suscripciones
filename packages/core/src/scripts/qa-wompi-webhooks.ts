#!/usr/bin/env tsx
/**
 * QA rápido de webhooks Wompi
 */

import { prisma } from "../db/prisma";

async function main() {
  const hours = Number(process.env.QA_HOURS || 24);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  console.log(`🔎 QA Webhooks Wompi (últimas ${hours}h)`);

  const [total, byStatus, byEvent, staleReceived, failedForward, pendingForward, pendingProcess] = await Promise.all([
    prisma.webhookEvent.count({ where: { provider: "WOMPI", receivedAt: { gte: since } } }),
    prisma.webhookEvent.groupBy({
      by: ["processStatus"],
      where: { provider: "WOMPI", receivedAt: { gte: since } },
      _count: { _all: true }
    }),
    prisma.webhookEvent.groupBy({
      by: ["eventName"],
      where: { provider: "WOMPI", receivedAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { eventName: "desc" } },
      take: 20
    }),
    prisma.webhookEvent.count({
      where: { provider: "WOMPI", processStatus: "RECEIVED", receivedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } }
    }),
    prisma.retryJob.count({ where: { type: "FORWARD_WOMPI_TO_SHOPIFY", status: "FAILED", updatedAt: { gte: since } } }),
    prisma.retryJob.count({ where: { type: "FORWARD_WOMPI_TO_SHOPIFY", status: "PENDING" } }),
    prisma.retryJob.count({ where: { type: "PROCESS_WOMPI_EVENT", status: "PENDING" } })
  ]);

  console.log(`Total eventos: ${total}`);
  console.log("Por estado:");
  byStatus.forEach((r) => console.log(`  - ${r.processStatus}: ${(r._count as any)._all}`));

  console.log("Top eventos:");
  byEvent.forEach((r) => console.log(`  - ${r.eventName}: ${(r._count as any)._all}`));

  console.log(`RECEIVED > 30 min: ${staleReceived}`);
  console.log(`Forward Shopify FAILED (24h): ${failedForward}`);
  console.log(`Forward Shopify PENDING: ${pendingForward}`);
  console.log(`Process Wompi PENDING: ${pendingProcess}`);
}

main()
  .catch((err) => {
    console.error("❌ Error:", err?.message || err);
    process.exit(1);
  })
  .then(() => process.exit(0));
