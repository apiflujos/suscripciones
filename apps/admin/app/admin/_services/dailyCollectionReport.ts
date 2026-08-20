import "server-only";

import { prisma } from "@suscripciones/database";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { readSubscriptionTotalInCents } from "@suscripciones/core/services/subscriptionBilling";

export type CollectionRowMessage = {
  type: string;
  status: string;
  content: string;
  to: string | null;
  errorMessage: string | null;
  sentAt: string | null;
};

export type CollectionRow = {
  subscriptionId: string;
  customerName: string;
  customerPhone: string | null;
  planName: string;
  amountInCents: number;
  cycleNumber: number;
  dueAt: string;
  cycleStatus: string;
  paymentStatus: string | null;
  paymentOrigin: string | null;
  wompiTransactionId: string | null;
  messages: CollectionRowMessage[];
};

export type DailyCollectionReport = {
  date: string;
  autoDebit: CollectionRow[];
  paymentLink: CollectionRow[];
  manual: CollectionRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reporte operativo de un día de corte: por cada suscripción con ciclo vencido,
 * qué se intentó cobrar, cómo quedó el pago y si la notificación llegó al cliente.
 * Se agrupa por modo de cobro porque débito y link se revisan distinto: en débito
 * importa si la tarjeta pasó, en link si el mensaje salió.
 */
export async function getDailyCollectionReport(args?: {
  tenantId?: string | null;
  date?: Date;
}): Promise<DailyCollectionReport> {
  const asOf = args?.date instanceof Date && !Number.isNaN(args.date.getTime()) ? args.date : new Date();
  const dayStart = new Date(asOf.getTime() - DAY_MS);

  const cycles = await prisma.subscriptionBillingCycle.findMany({
    where: {
      status: { not: "PAID" },
      dueAt: { lte: asOf },
      subscription: {
        status: { in: ["ACTIVE", "PAST_DUE"] },
        ...(args?.tenantId ? { tenantId: args.tenantId } : {})
      }
    },
    include: {
      subscription: {
        include: { customer: true, plan: true }
      }
    },
    orderBy: [{ dueAt: "desc" }]
  });

  if (!cycles.length) {
    return { date: asOf.toISOString(), autoDebit: [], paymentLink: [], manual: [] };
  }

  const subscriptionIds = Array.from(new Set(cycles.map((c) => c.subscriptionId)));

  const [payments, messages] = await Promise.all([
    prisma.payment.findMany({
      where: { subscriptionId: { in: subscriptionIds } },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        subscriptionId: true,
        cycleNumber: true,
        status: true,
        origin: true,
        wompiTransactionId: true
      }
    }),
    prisma.chatwootMessage.findMany({
      where: {
        subscriptionId: { in: subscriptionIds },
        createdAt: { gte: dayStart }
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        subscriptionId: true,
        type: true,
        status: true,
        content: true,
        to: true,
        errorMessage: true,
        sentAt: true
      }
    })
  ]);

  const paymentByCycle = new Map<string, (typeof payments)[number]>();
  for (const p of payments) {
    if (p.cycleNumber == null) continue;
    const key = `${p.subscriptionId}:${p.cycleNumber}`;
    if (!paymentByCycle.has(key)) paymentByCycle.set(key, p);
  }

  const messagesBySubscription = new Map<string, CollectionRowMessage[]>();
  for (const m of messages) {
    if (!m.subscriptionId) continue;
    const list = messagesBySubscription.get(m.subscriptionId) ?? [];
    list.push({
      type: String(m.type),
      status: String(m.status),
      content: String(m.content || ""),
      to: m.to ?? null,
      errorMessage: m.errorMessage ?? null,
      sentAt: m.sentAt ? m.sentAt.toISOString() : null
    });
    messagesBySubscription.set(m.subscriptionId, list);
  }

  const report: DailyCollectionReport = {
    date: asOf.toISOString(),
    autoDebit: [],
    paymentLink: [],
    manual: []
  };

  for (const cycle of cycles) {
    const sub = cycle.subscription;
    if (!sub) continue;
    const payment = paymentByCycle.get(`${cycle.subscriptionId}:${cycle.cycleNumber}`) ?? null;

    const row: CollectionRow = {
      subscriptionId: sub.id,
      customerName: sub.customer?.name || "(sin nombre)",
      customerPhone: sub.customer?.phone ?? null,
      planName: sub.plan?.name || "(sin plan)",
      amountInCents: readSubscriptionTotalInCents(sub.metadata, sub.plan?.priceInCents ?? 0, sub.plan?.metadata),
      cycleNumber: cycle.cycleNumber,
      dueAt: cycle.dueAt.toISOString(),
      cycleStatus: String(cycle.status),
      paymentStatus: payment ? String(payment.status) : null,
      paymentOrigin: payment ? String(payment.origin) : null,
      wompiTransactionId: payment?.wompiTransactionId ?? null,
      messages: messagesBySubscription.get(sub.id) ?? []
    };

    const mode = resolveSubscriptionCollectionMode(sub);
    if (mode === "AUTO_DEBIT") report.autoDebit.push(row);
    else if (mode === "AUTO_LINK") report.paymentLink.push(row);
    else report.manual.push(row);
  }

  return report;
}
