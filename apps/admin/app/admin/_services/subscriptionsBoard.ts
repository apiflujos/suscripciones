import "server-only";

import { prisma } from "@suscripciones/database";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { readSubscriptionTotalInCents } from "@suscripciones/core/services/subscriptionBilling";
import { resolveCollectionDelinquency } from "@suscripciones/core/services/billingCycles";
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

/** Sin acentos ni mayúsculas: así "Gomez" encuentra a "Gómez". */
function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Solo los dígitos: así "300 111 22 33" encuentra a "+573001112233". */
function digitsOf(value: string) {
  return value.replace(/\D+/g, "");
}

/**
 * Filtra las filas del tablero. Vive junto al servicio para que la vista y la
 * exportación apliquen exactamente el mismo criterio: un Excel que no coincide
 * con lo que se ve en pantalla es peor que no tener Excel.
 */
export function filterBoardRows(rows: SubscriptionBoardRow[], filter: BoardFilter): SubscriptionBoardRow[] {
  const mode = String(filter.mode || "").trim().toUpperCase();
  const state = String(filter.state || "").trim().toUpperCase();
  const notified = String(filter.notified || "").trim().toLowerCase();
  const q = normalizeText(String(filter.q || ""));
  // Un teléfono se busca por dígitos; tres es el mínimo para que la búsqueda
  // de un nombre con un número suelto no arrastre media cartera.
  const qDigits = digitsOf(String(filter.q || ""));
  const phoneSearch = qDigits.length >= 3;

  return rows.filter((row) => {
    if (mode && row.mode !== mode) return false;
    if (state && row.delinquency !== state) return false;
    // "failed" se acepta por los enlaces viejos: un aviso que falló es, para
    // quien opera, un aviso que no llegó.
    if ((notified === "no" || notified === "failed") && row.messageDelivered === true) return false;
    if (q) {
      const haystack = normalizeText([row.customerName, row.planName, row.customerPhone ?? ""].join(" "));
      if (haystack.includes(q)) return true;
      if (phoneSearch && digitsOf(row.customerPhone ?? "").includes(qDigits)) return true;
      return false;
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

/** El ciclo que gobierna la fila ya está cobrado. */
function isRowCyclePaid(row: SubscriptionBoardRow) {
  return String(row.cycleStatus || "").toUpperCase() === "PAID";
}

/** Hay plata por cobrar y el cliente no se enteró. */
function isRowNotNotified(row: SubscriptionBoardRow) {
  return !isRowCyclePaid(row) && row.messageDelivered !== true;
}

/** Se le va a cobrar solo, pero no hay tarjeta que cobrar. */
function isRowWithoutCard(row: SubscriptionBoardRow) {
  return row.mode === "AUTO_DEBIT" && !row.hasCard;
}

/**
 * Resumen (totales y desglose por modo) derivado de las filas que se van a
 * mostrar. Al calcularse sobre las mismas filas, el encabezado no puede
 * contradecir a la tabla que tiene debajo, ni siquiera con un filtro puesto.
 */
export function summarizeBoardRows(rows: SubscriptionBoardRow[]): Omit<SubscriptionsBoard, "rows"> {
  const summaries = new Map<CollectionMode, ModeSummary>(MODES.map((m) => [m, emptySummary(m)]));

  for (const row of rows) {
    let summary = summaries.get(row.mode);
    if (!summary) {
      summary = emptySummary(row.mode);
      summaries.set(row.mode, summary);
    }
    const paid = isRowCyclePaid(row);
    summary.subscriptions += 1;
    summary.expectedInCents += row.amountInCents;
    if (paid) {
      summary.paid += 1;
      summary.collectedInCents += row.amountInCents;
    } else {
      summary.pendingInCents += row.amountInCents;
    }
    if (row.delinquency === "EN_MORA") summary.overdue += 1;
    else if (row.delinquency === "EN_GRACIA") summary.inGrace += 1;
    else summary.current += 1;
    if (isRowWithoutCard(row)) summary.withoutCard += 1;
    if (isRowNotNotified(row)) summary.notNotified += 1;
  }

  // Los modos conocidos primero y en orden fijo; si apareciera uno inesperado
  // se muestra igual, para que ninguna suscripción quede fuera del desglose.
  const extraModes = Array.from(summaries.keys()).filter((m) => !MODES.includes(m));
  const byMode = [...MODES, ...extraModes]
    .map((m) => summaries.get(m))
    .filter((s): s is ModeSummary => Boolean(s && s.subscriptions > 0));

  const sumCents = (subset: SubscriptionBoardRow[]) => subset.reduce((acc, r) => acc + r.amountInCents, 0);
  const paidRows = rows.filter(isRowCyclePaid);
  const unpaidRows = rows.filter((r) => !isRowCyclePaid(r));
  // Partición exacta —igual que el bucle de arriba—: las tres cifras de estado
  // siempre suman el total, sin filas que se pierdan por el camino.
  const overdue = rows.filter((r) => r.delinquency === "EN_MORA");
  const inGrace = rows.filter((r) => r.delinquency === "EN_GRACIA");
  const current = rows.filter((r) => r.delinquency !== "EN_MORA" && r.delinquency !== "EN_GRACIA");

  // Todo sale de `rows`: ningún total puede quedar desalineado del desglose.
  return {
    totals: {
      subscriptions: rows.length,
      mrrInCents: sumCents(rows),
      expectedInCents: sumCents(rows),
      collectedInCents: sumCents(paidRows),
      pendingInCents: sumCents(unpaidRows),
      current: current.length,
      inGrace: inGrace.length,
      overdue: overdue.length,
      currentInCents: sumCents(current),
      inGraceInCents: sumCents(inGrace),
      overdueInCents: sumCents(overdue),
      notNotified: rows.filter(isRowNotNotified).length,
      withoutCard: rows.filter(isRowWithoutCard).length
    },
    byMode
  };
}

/** El tablero recortado a un filtro: filas y resumen calculados sobre lo mismo. */
export function applyBoardFilter(board: SubscriptionsBoard, filter: BoardFilter): SubscriptionsBoard {
  const rows = filterBoardRows(board.rows, filter);
  return { ...summarizeBoardRows(rows), rows };
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
          select: { subscriptionId: true, status: true, content: true }
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
      messageContent: message?.content ?? null
    };
    rows.push(row);
  }

  rows.sort((a, b) => {
    const rank = { EN_MORA: 0, EN_GRACIA: 1, AL_DIA: 2 } as const;
    if (rank[a.delinquency] !== rank[b.delinquency]) return rank[a.delinquency] - rank[b.delinquency];
    return a.customerName.localeCompare(b.customerName, "es");
  });

  return { ...summarizeBoardRows(rows), rows };
}
