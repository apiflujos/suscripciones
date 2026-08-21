import "server-only";

import { prisma } from "@suscripciones/database";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { readSubscriptionTotalInCents } from "@suscripciones/core/services/subscriptionBilling";
import { resolveCollectionDelinquency, isBillingCyclePaid } from "@suscripciones/core/services/billingCycles";
import { hasActiveCustomerPaymentSource } from "@suscripciones/core/lib/customerMetadata";

export type CollectionMode = "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK";
export type DelinquencyStatus = "AL_DIA" | "EN_GRACIA" | "EN_MORA";

export type SubscriptionBoardRow = {
  subscriptionId: string;
  customerName: string;
  customerPhone: string | null;
  planName: string;
  mode: CollectionMode;
  subscriptionStatus: string;
  amountInCents: number;
  cycleNumber: number | null;
  cycleDueAt: string | null;
  cycleStatus: string | null;
  delinquency: DelinquencyStatus;
  daysPastDue: number;
  hasCard: boolean;
  lastPaymentStatus: string | null;
  lastPaymentAt: string | null;
  messageDelivered: boolean | null;
  messageError: string | null;
  messageContent: string | null;
};

export type ModeSummary = {
  mode: CollectionMode;
  subscriptions: number;
  expectedInCents: number;
  collectedInCents: number;
  pendingInCents: number;
  paid: number;
  current: number;
  overdue: number;
  inGrace: number;
  withoutCard: number;
  notNotified: number;
};

export type SubscriptionsBoard = {
  totals: {
    subscriptions: number;
    mrrInCents: number;
    expectedInCents: number;
    collectedInCents: number;
    pendingInCents: number;
    current: number;
    inGrace: number;
    overdue: number;
    currentInCents: number;
    inGraceInCents: number;
    overdueInCents: number;
    notNotified: number;
    withoutCard: number;
  };
  byMode: ModeSummary[];
  rows: SubscriptionBoardRow[];
};

export type BoardFilter = {
  mode?: string | null;
  state?: string | null;
  notified?: string | null;
  q?: string | null;
};

/**
 * Filtra las filas del tablero. Vive junto al servicio para que la vista y la
 * exportación apliquen exactamente el mismo criterio: un Excel que no coincide
 * con lo que se ve en pantalla es peor que no tener Excel.
 */
export function filterBoardRows(rows: SubscriptionBoardRow[], filter: BoardFilter): SubscriptionBoardRow[] {
  const mode = String(filter.mode || "").trim().toUpperCase();
  const state = String(filter.state || "").trim().toUpperCase();
  const notified = String(filter.notified || "").trim().toLowerCase();
  const q = String(filter.q || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (mode && row.mode !== mode) return false;
    if (state && row.delinquency !== state) return false;
    if (notified === "no" && row.messageDelivered === true) return false;
    if (notified === "failed" && row.messageDelivered !== false) return false;
    if (q) {
      const haystack = [row.customerName, row.planName, row.customerPhone ?? ""].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MODES: CollectionMode[] = ["AUTO_DEBIT", "AUTO_LINK", "MANUAL_LINK"];

function emptySummary(mode: CollectionMode): ModeSummary {
  return {
    mode,
    subscriptions: 0,
    expectedInCents: 0,
    collectedInCents: 0,
    pendingInCents: 0,
    paid: 0,
    current: 0,
    overdue: 0,
    inGrace: 0,
    withoutCard: 0,
    notNotified: 0
  };
}

/**
 * Estado completo de la cartera: una fila por suscripción con su ciclo de cobro
 * vigente, cómo quedó el pago y si el cliente llegó a enterarse.
 *
 * Los totales se calculan sobre las mismas filas que se listan, para que el
 * resumen y el detalle no puedan contradecirse.
 */
export async function getSubscriptionsBoard(args?: {
  tenantId?: string | null;
  graceDays?: number;
  asOf?: Date;
}): Promise<SubscriptionsBoard> {
  const asOf = args?.asOf instanceof Date && !Number.isNaN(args.asOf.getTime()) ? args.asOf : new Date();
  const graceDays = Number.isFinite(Number(args?.graceDays)) ? Math.max(0, Math.trunc(Number(args?.graceDays))) : 5;

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] },
      ...(args?.tenantId ? { tenantId: args.tenantId } : {})
    },
    include: {
      customer: true,
      plan: true,
      billingCycles: { orderBy: [{ cycleNumber: "asc" }] }
    }
  });

  const subscriptionIds = subscriptions.map((s) => s.id);

  const [payments, messages] = await Promise.all([
    subscriptionIds.length
      ? prisma.payment.findMany({
          where: { subscriptionId: { in: subscriptionIds } },
          orderBy: [{ createdAt: "desc" }],
          select: { subscriptionId: true, cycleNumber: true, status: true, paidAt: true, createdAt: true }
        })
      : Promise.resolve([]),
    subscriptionIds.length
      ? prisma.chatwootMessage.findMany({
          where: {
            subscriptionId: { in: subscriptionIds },
            createdAt: { gte: new Date(asOf.getTime() - 7 * DAY_MS) }
          },
          orderBy: [{ createdAt: "desc" }],
          select: { subscriptionId: true, status: true, errorMessage: true, content: true }
        })
      : Promise.resolve([])
  ]);

  const paymentByCycle = new Map<string, (typeof payments)[number]>();
  for (const p of payments) {
    if (p.cycleNumber == null) continue;
    const key = `${p.subscriptionId}:${p.cycleNumber}`;
    if (!paymentByCycle.has(key)) paymentByCycle.set(key, p);
  }

  const lastMessage = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (!m.subscriptionId) continue;
    if (!lastMessage.has(m.subscriptionId)) lastMessage.set(m.subscriptionId, m);
  }

  const rows: SubscriptionBoardRow[] = [];
  const summaries = new Map<CollectionMode, ModeSummary>(MODES.map((m) => [m, emptySummary(m)]));

  for (const sub of subscriptions) {
    // El ciclo que gobierna el cobro es el más antiguo sin pagar; si están todos
    // al día, se toma el último para mostrar el período vigente.
    const unpaid = sub.billingCycles.filter((c) => String(c.status) !== "PAID" && String(c.status) !== "SKIPPED");
    const cycle = unpaid[0] ?? sub.billingCycles[sub.billingCycles.length - 1] ?? null;

    const delinquencyInfo = resolveCollectionDelinquency({
      cycle,
      graceDays,
      asOf,
      fallbackSubscriptionStatus: sub.status
    });

    const mode = resolveSubscriptionCollectionMode(sub) as CollectionMode;
    const amountInCents = readSubscriptionTotalInCents(sub.metadata, sub.plan?.priceInCents ?? 0, sub.plan?.metadata);
    const payment = cycle ? paymentByCycle.get(`${sub.id}:${cycle.cycleNumber}`) ?? null : null;
    const message = lastMessage.get(sub.id) ?? null;
    const cyclePaid = isBillingCyclePaid(cycle);
    const hasCard = hasActiveCustomerPaymentSource(sub.customer?.metadata);

    const row: SubscriptionBoardRow = {
      subscriptionId: sub.id,
      customerName: sub.customer?.name || "(sin nombre)",
      customerPhone: sub.customer?.phone ?? null,
      planName: sub.plan?.name || "(sin plan)",
      mode,
      subscriptionStatus: String(sub.status),
      amountInCents,
      cycleNumber: cycle?.cycleNumber ?? null,
      cycleDueAt: cycle?.dueAt ? cycle.dueAt.toISOString() : null,
      cycleStatus: cycle ? String(cycle.status) : null,
      delinquency: delinquencyInfo.status,
      daysPastDue: delinquencyInfo.daysPastDue ?? 0,
      hasCard,
      lastPaymentStatus: payment ? String(payment.status) : null,
      lastPaymentAt: payment?.paidAt ? payment.paidAt.toISOString() : null,
      messageDelivered: message ? String(message.status) === "SENT" : null,
      messageError: message?.errorMessage ?? null,
      messageContent: message?.content ?? null
    };
    rows.push(row);

    const summary = summaries.get(mode)!;
    summary.subscriptions += 1;
    summary.expectedInCents += amountInCents;
    if (cyclePaid) {
      summary.paid += 1;
      summary.collectedInCents += amountInCents;
    } else {
      summary.pendingInCents += amountInCents;
    }
    if (row.delinquency === "EN_MORA") summary.overdue += 1;
    else if (row.delinquency === "EN_GRACIA") summary.inGrace += 1;
    else summary.current += 1;
    if (!hasCard && mode === "AUTO_DEBIT") summary.withoutCard += 1;
    if (!cyclePaid && row.messageDelivered !== true) summary.notNotified += 1;
  }

  rows.sort((a, b) => {
    const rank = { EN_MORA: 0, EN_GRACIA: 1, AL_DIA: 2 } as const;
    if (rank[a.delinquency] !== rank[b.delinquency]) return rank[a.delinquency] - rank[b.delinquency];
    return a.customerName.localeCompare(b.customerName, "es");
  });

  const byMode = MODES.map((m) => summaries.get(m)!).filter((s) => s.subscriptions > 0);

  return {
    totals: {
      subscriptions: rows.length,
      mrrInCents: rows.reduce((acc, r) => acc + r.amountInCents, 0),
      expectedInCents: byMode.reduce((acc, s) => acc + s.expectedInCents, 0),
      collectedInCents: byMode.reduce((acc, s) => acc + s.collectedInCents, 0),
      pendingInCents: byMode.reduce((acc, s) => acc + s.pendingInCents, 0),
      current: rows.filter((r) => r.delinquency === "AL_DIA").length,
      inGrace: rows.filter((r) => r.delinquency === "EN_GRACIA").length,
      overdue: rows.filter((r) => r.delinquency === "EN_MORA").length,
      currentInCents: rows
        .filter((r) => r.delinquency === "AL_DIA")
        .reduce((acc, r) => acc + r.amountInCents, 0),
      inGraceInCents: rows
        .filter((r) => r.delinquency === "EN_GRACIA")
        .reduce((acc, r) => acc + r.amountInCents, 0),
      overdueInCents: rows
        .filter((r) => r.delinquency === "EN_MORA")
        .reduce((acc, r) => acc + r.amountInCents, 0),
      notNotified: byMode.reduce((acc, s) => acc + s.notNotified, 0),
      withoutCard: byMode.reduce((acc, s) => acc + s.withoutCard, 0)
    },
    byMode,
    rows
  };
}
