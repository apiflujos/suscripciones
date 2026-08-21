import "server-only";

import { prisma } from "@suscripciones/database";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { readSubscriptionTotalInCents } from "@suscripciones/core/services/subscriptionBilling";
import { resolveCollectionDelinquency } from "@suscripciones/core/services/billingCycles";
import { hasActiveCustomerPaymentSource } from "@suscripciones/core/lib/customerMetadata";
import { describeChargeFailure, humanizeNotificationError } from "../../lib/humanizeErrors";

export type CollectionMode = "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK";
export type DelinquencyStatus = "AL_DIA" | "EN_GRACIA" | "EN_MORA";

/** El último aviso que salió (o intentó salir) hacia el cliente. */
export type BoardNotice = {
  kind: string;
  status: "SENT" | "FAILED" | "PENDING";
  at: string | null;
  /** Solo cuando falló, y ya traducido a por qué no llegó. */
  reason: string | null;
  content: string | null;
};

/**
 * Cuándo se cobra el ciclo vigente: `RETRY` es un reintento agendado y `DUE`
 * su fecha de corte. Si el ciclo ya está cobrado no hay nada que esperar, y si
 * no está cobrado y esto viene vacío, nadie se lo va a cobrar.
 */
export type BoardNextCharge = {
  at: string;
  kind: "RETRY" | "DUE";
};

export type BoardChargeFailure = {
  at: string | null;
  reason: string;
};

export type SubscriptionBoardRow = {
  subscriptionId: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  planName: string;
  mode: CollectionMode;
  subscriptionStatus: string;
  amountInCents: number;
  /** El ciclo que gobierna el cobro: es lo que está al día, en gracia o en mora. */
  cycleNumber: number | null;
  cycleDueAt: string | null;
  cycleStatus: string | null;
  cyclePaid: boolean;
  cyclePaidAt: string | null;
  delinquency: DelinquencyStatus;
  daysPastDue: number;
  hasCard: boolean;
  nextCharge: BoardNextCharge | null;
  notice: BoardNotice | null;
  chargeFailure: BoardChargeFailure | null;
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
  unscheduled: number;
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
    unscheduled: number;
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
    if ((notified === "no" || notified === "failed") && row.notice?.status === "SENT") return false;
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
/** Ventana de avisos que se considera vigente para la cartera actual. */
const NOTICE_WINDOW_DAYS = 30;
/** Tope de reintentos que se leen de una vez para cruzarlos con la cartera. */
const RETRY_SCAN_LIMIT = 500;

const NOTICE_KIND_LABEL: Record<string, string> = {
  PAYMENT_LINK: "Link de pago",
  PAYMENT_CONFIRMED: "Confirmación de pago",
  EXPIRY_WARNING: "Aviso de vencimiento",
  PAYMENT_FAILED: "Aviso de cobro fallido"
};

function readPayloadSubscriptionId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).subscriptionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
    notNotified: 0,
    unscheduled: 0
  };
}

/** El ciclo que gobierna la fila ya está cobrado. */
function isRowCyclePaid(row: SubscriptionBoardRow) {
  return row.cyclePaid;
}

/** Hay plata por cobrar y el aviso no llegó. */
function isRowNotNotified(row: SubscriptionBoardRow) {
  return !row.cyclePaid && row.notice?.status !== "SENT";
}

/** Hay un ciclo sin pagar y nadie lo tiene agendado para cobrar. */
function isRowUnscheduled(row: SubscriptionBoardRow) {
  return !row.cyclePaid && !row.nextCharge;
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
    if (isRowUnscheduled(row)) summary.unscheduled += 1;
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
      withoutCard: rows.filter(isRowWithoutCard).length,
      unscheduled: rows.filter(isRowUnscheduled).length
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
  const customerIds = Array.from(new Set(subscriptions.map((s) => s.customerId).filter(Boolean) as string[]));

  const [payments, messages, retries] = await Promise.all([
    subscriptionIds.length
      ? prisma.payment.findMany({
          where: { subscriptionId: { in: subscriptionIds } },
          orderBy: [{ createdAt: "desc" }],
          select: {
            subscriptionId: true,
            cycleNumber: true,
            status: true,
            origin: true,
            paidAt: true,
            failedAt: true,
            createdAt: true
          }
        })
      : Promise.resolve([]),
    // Los avisos de tokenización cuelgan del cliente y no de la suscripción,
    // así que se traen por ambos lados: que no se haya podido pedir la tarjeta
    // es justamente lo que explica que el débito automático no cobre.
    subscriptionIds.length
      ? prisma.chatwootMessage.findMany({
          where: {
            createdAt: { gte: new Date(asOf.getTime() - NOTICE_WINDOW_DAYS * DAY_MS) },
            OR: [
              { subscriptionId: { in: subscriptionIds } },
              ...(customerIds.length ? [{ subscriptionId: null, customerId: { in: customerIds } }] : [])
            ]
          },
          orderBy: [{ createdAt: "desc" }],
          select: {
            subscriptionId: true,
            customerId: true,
            type: true,
            status: true,
            errorMessage: true,
            content: true,
            sentAt: true,
            createdAt: true
          }
        })
      : Promise.resolve([]),
    // Un reintento agendado es la respuesta a "¿cuándo le vuelven a cobrar?".
    subscriptionIds.length
      ? prisma.retryJob.findMany({
          where: { status: { in: ["PENDING", "RUNNING"] }, type: "PAYMENT_RETRY" },
          orderBy: [{ runAt: "asc" }],
          take: RETRY_SCAN_LIMIT,
          select: { runAt: true, payload: true }
        })
      : Promise.resolve([])
  ]);

  const paymentByCycle = new Map<string, (typeof payments)[number]>();
  const failedPaymentBySub = new Map<string, (typeof payments)[number]>();
  for (const p of payments) {
    if (p.cycleNumber != null) {
      const key = `${p.subscriptionId}:${p.cycleNumber}`;
      if (!paymentByCycle.has(key)) paymentByCycle.set(key, p);
    }
    const status = String(p.status);
    if ((status === "DECLINED" || status === "ERROR") && p.subscriptionId && !failedPaymentBySub.has(p.subscriptionId)) {
      failedPaymentBySub.set(p.subscriptionId, p);
    }
  }

  // El aviso que importa es el último: por suscripción si lo tiene, y si no,
  // el del cliente (tokenización), que aplica a todas sus suscripciones.
  const lastMessageBySub = new Map<string, (typeof messages)[number]>();
  const lastMessageByCustomer = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (m.subscriptionId) {
      if (!lastMessageBySub.has(m.subscriptionId)) lastMessageBySub.set(m.subscriptionId, m);
    } else if (m.customerId && !lastMessageByCustomer.has(m.customerId)) {
      lastMessageByCustomer.set(m.customerId, m);
    }
  }

  const nextRetryBySub = new Map<string, Date>();
  for (const job of retries) {
    const subId = readPayloadSubscriptionId(job.payload);
    if (!subId || nextRetryBySub.has(subId)) continue;
    nextRetryBySub.set(subId, job.runAt);
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
    const message = lastMessageBySub.get(sub.id) ?? (sub.customerId ? lastMessageByCustomer.get(sub.customerId) ?? null : null);
    const hasCard = hasActiveCustomerPaymentSource(sub.customer?.metadata);
    const cyclePaid = cycle ? String(cycle.status) === "PAID" : false;

    // Solo el cobro del ciclo vigente: un reintento agendado o su fecha de
    // corte. El corte del ciclo siguiente es plata del mes que viene y aquí
    // solo estorba a quien está operando el de hoy.
    const retryAt = cyclePaid ? null : nextRetryBySub.get(sub.id) ?? null;
    const nextCharge: BoardNextCharge | null = cyclePaid
      ? null
      : retryAt
        ? { at: retryAt.toISOString(), kind: "RETRY" }
        : cycle?.dueAt
          ? { at: cycle.dueAt.toISOString(), kind: "DUE" }
          : null;

    const failedPayment = cyclePaid ? null : failedPaymentBySub.get(sub.id) ?? null;

    const row: SubscriptionBoardRow = {
      subscriptionId: sub.id,
      customerId: sub.customerId ?? null,
      customerName: sub.customer?.name || "(sin nombre)",
      customerPhone: sub.customer?.phone ?? null,
      planName: sub.plan?.name || "(sin plan)",
      mode,
      subscriptionStatus: String(sub.status),
      amountInCents,
      cycleNumber: cycle?.cycleNumber ?? null,
      cycleDueAt: cycle?.dueAt ? cycle.dueAt.toISOString() : null,
      cycleStatus: cycle ? String(cycle.status) : null,
      cyclePaid,
      cyclePaidAt: cycle?.paidAt ? cycle.paidAt.toISOString() : payment?.paidAt?.toISOString() ?? null,
      delinquency: delinquencyInfo.status,
      daysPastDue: delinquencyInfo.daysPastDue ?? 0,
      hasCard,
      nextCharge,
      notice: message
        ? {
            kind: NOTICE_KIND_LABEL[String(message.type)] ?? String(message.type),
            status: String(message.status) === "SENT" ? "SENT" : String(message.status) === "FAILED" ? "FAILED" : "PENDING",
            at: (message.sentAt ?? message.createdAt)?.toISOString() ?? null,
            reason: String(message.status) === "FAILED" ? humanizeNotificationError(message.errorMessage || "") : null,
            content: message.content ?? null
          }
        : null,
      chargeFailure: failedPayment
        ? {
            at: (failedPayment.failedAt ?? failedPayment.createdAt)?.toISOString() ?? null,
            reason: describeChargeFailure(String(failedPayment.status), String(failedPayment.origin))
          }
        : null
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
