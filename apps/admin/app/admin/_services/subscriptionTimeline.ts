import "server-only";

import { prisma } from "@suscripciones/database";
import { resolveSubscriptionCollectionMode } from "@suscripciones/core/services/subscriptionMode";
import { readSubscriptionTotalInCents } from "@suscripciones/core/services/subscriptionBilling";
import { hasActiveCustomerPaymentSource } from "@suscripciones/core/lib/customerMetadata";
import { JOB_LABEL, TRIGGER_LABEL } from "./scheduledJobsReport";
import { describeChargeFailure, humanizeNotificationError } from "../../lib/humanizeErrors";

export type TimelineTone = "ok" | "warn" | "bad" | "muted";

/** Un hecho de la suscripción, contado en términos de negocio. */
export type TimelineEntry = {
  at: string | null;
  title: string;
  detail: string | null;
  tone: TimelineTone;
};

export type TimelineCycle = {
  cycleNumber: number;
  periodStartAt: string | null;
  periodEndAt: string | null;
  dueAt: string | null;
  status: string;
  paidAt: string | null;
  daysLate: number | null;
  amountInCents: number;
};

export type SubscriptionTimeline = {
  subscriptionId: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  planName: string;
  tenantId: string | null;
  mode: string;
  subscriptionStatus: string;
  amountInCents: number;
  hasCard: boolean;
  /** Lo que ya pasó, de lo más reciente a lo más viejo. */
  done: TimelineEntry[];
  /** Lo que quedó pendiente, de lo más urgente a lo menos. */
  pending: TimelineEntry[];
  /** Lo que el sistema va a ejecutar, del próximo al último. */
  scheduled: TimelineEntry[];
  /** Todos los ciclos, del más nuevo al más viejo. */
  cycles: TimelineCycle[];
  /** Los jobs se leen con un tope; avisa si quedaron fuera. */
  truncated: boolean;
};

const MESSAGE_TYPE_LABEL: Record<string, string> = {
  PAYMENT_LINK: "Link de pago",
  PAYMENT_CONFIRMED: "Confirmación de pago",
  EXPIRY_WARNING: "Aviso de vencimiento",
  PAYMENT_FAILED: "Aviso de cobro fallido"
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  APPROVED: "Pago aprobado",
  PENDING: "Pago en curso"
};

const JOBS_LIMIT = 25;
const HISTORY_LIMIT = 12;

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function money(cents: number) {
  return `$${Math.round((cents || 0) / 100).toLocaleString("es-CO")}`;
}

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Más reciente primero; lo que no tiene fecha va al final. */
function byRecent(a: TimelineEntry, b: TimelineEntry) {
  if (!a.at && !b.at) return 0;
  if (!a.at) return 1;
  if (!b.at) return -1;
  return b.at.localeCompare(a.at);
}

/**
 * La historia operativa de una suscripción: qué se hizo, qué quedó pendiente y
 * qué va a ejecutar el sistema.
 *
 * Se carga solo para la suscripción que se está mirando, no para toda la
 * cartera: es la diferencia entre abrir un detalle y arrastrar el tablero
 * entero con datos que nadie pidió.
 */
export async function getSubscriptionTimeline(subscriptionId: string): Promise<SubscriptionTimeline | null> {
  const id = String(subscriptionId || "").trim();
  if (!id) return null;

  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: {
      customer: true,
      plan: true,
      billingCycles: { orderBy: [{ cycleNumber: "asc" }] }
    }
  });
  if (!sub) return null;

  const [payments, messages, jobs] = await Promise.all([
    prisma.payment.findMany({
      where: { subscriptionId: id },
      orderBy: [{ createdAt: "desc" }],
      take: HISTORY_LIMIT,
      select: { id: true, status: true, amountInCents: true, cycleNumber: true, origin: true, paidAt: true, failedAt: true, createdAt: true }
    }),
    // Los avisos de tokenización cuelgan del cliente, no de la suscripción:
    // sin ellos no se ve por qué el débito automático se quedó sin tarjeta.
    prisma.chatwootMessage.findMany({
      where: sub.customerId
        ? { OR: [{ subscriptionId: id }, { subscriptionId: null, customerId: sub.customerId }] }
        : { subscriptionId: id },
      orderBy: [{ createdAt: "desc" }],
      take: HISTORY_LIMIT,
      select: { id: true, type: true, status: true, errorMessage: true, content: true, sentAt: true, createdAt: true }
    }),
    prisma.retryJob.findMany({
      where: {
        status: { in: ["PENDING", "RUNNING"] },
        payload: { path: ["subscriptionId"], equals: id }
      },
      orderBy: [{ runAt: "asc" }],
      take: JOBS_LIMIT + 1
    })
  ]);

  const amountInCents = readSubscriptionTotalInCents(sub.metadata, sub.plan?.priceInCents ?? 0, sub.plan?.metadata);
  const mode = String(resolveSubscriptionCollectionMode(sub));
  const hasCard = hasActiveCustomerPaymentSource(sub.customer?.metadata);

  const cycles: TimelineCycle[] = sub.billingCycles.map((c) => ({
    cycleNumber: c.cycleNumber,
    periodStartAt: iso(c.periodStartAt),
    periodEndAt: iso(c.periodEndAt),
    dueAt: iso(c.dueAt),
    status: String(c.status),
    paidAt: iso(c.paidAt),
    daysLate: c.daysLate ?? null,
    amountInCents
  }));

  const done: TimelineEntry[] = [];
  const pending: TimelineEntry[] = [];

  for (const cycle of cycles) {
    if (cycle.status === "PAID") {
      done.push({
        at: cycle.paidAt ?? cycle.dueAt,
        title: `Ciclo ${cycle.cycleNumber} cobrado`,
        detail: `${money(cycle.amountInCents)}${cycle.daysLate ? ` · ${cycle.daysLate} días tarde` : ""}`,
        tone: "ok"
      });
    } else if (cycle.status === "SKIPPED") {
      done.push({
        at: cycle.dueAt,
        title: `Ciclo ${cycle.cycleNumber} omitido`,
        detail: "No se va a cobrar",
        tone: "muted"
      });
    } else {
      pending.push({
        at: cycle.dueAt,
        title: `Ciclo ${cycle.cycleNumber} sin cobrar`,
        detail: money(cycle.amountInCents),
        tone: "bad"
      });
    }
  }

  for (const p of payments) {
    const status = String(p.status);
    const detail = `${money(p.amountInCents)}${p.cycleNumber != null ? ` · ciclo ${p.cycleNumber}` : ""}`;
    if (status === "APPROVED") {
      done.push({ at: iso(p.paidAt) ?? iso(p.createdAt), title: PAYMENT_STATUS_LABEL.APPROVED, detail, tone: "ok" });
    } else if (status === "PENDING") {
      pending.push({ at: iso(p.createdAt), title: PAYMENT_STATUS_LABEL.PENDING, detail, tone: "warn" });
    } else if (status === "DECLINED" || status === "ERROR") {
      pending.push({
        at: iso(p.failedAt) ?? iso(p.createdAt),
        title: describeChargeFailure(status, String(p.origin)),
        detail,
        tone: "bad"
      });
    }
  }

  for (const m of messages) {
    const kind = MESSAGE_TYPE_LABEL[String(m.type)] ?? String(m.type);
    const status = String(m.status);
    if (status === "SENT") {
      done.push({
        at: iso(m.sentAt) ?? iso(m.createdAt),
        title: `${kind} entregado`,
        detail: m.content ? m.content.slice(0, 280) : null,
        tone: "ok"
      });
    } else if (status === "FAILED") {
      pending.push({
        at: iso(m.createdAt),
        title: `${kind} falló`,
        detail: humanizeNotificationError(m.errorMessage || ""),
        tone: "bad"
      });
    } else {
      pending.push({ at: iso(m.createdAt), title: `${kind} en cola`, detail: null, tone: "warn" });
    }
  }

  if (mode === "AUTO_DEBIT" && !hasCard) {
    pending.push({
      at: null,
      title: "Sin tarjeta registrada",
      detail: "El débito automático no puede ejecutarse hasta que el cliente registre una tarjeta",
      tone: "bad"
    });
  }

  const truncated = jobs.length > JOBS_LIMIT;
  const scheduled: TimelineEntry[] = jobs.slice(0, JOBS_LIMIT).map((job) => {
    const type = String(job.type);
    const trigger = readString(job.payload, "trigger");
    const attempts = job.attempts > 0 ? ` · intento ${job.attempts} de ${job.maxAttempts}` : "";
    const motivo = trigger ? `${TRIGGER_LABEL[trigger] ?? trigger}` : null;
    return {
      at: iso(job.runAt),
      title: JOB_LABEL[type] ?? type,
      detail: [motivo, String(job.status) === "RUNNING" ? "ejecutándose ahora" : null, attempts.trim() || null]
        .filter(Boolean)
        .join(" · ") || null,
      tone: String(job.status) === "RUNNING" ? "warn" : "muted"
    };
  });

  return {
    subscriptionId: sub.id,
    customerId: sub.customerId ?? null,
    customerName: sub.customer?.name || "(sin nombre)",
    customerPhone: sub.customer?.phone ?? null,
    planName: sub.plan?.name || "(sin plan)",
    tenantId: sub.tenantId ?? null,
    mode,
    subscriptionStatus: String(sub.status),
    amountInCents,
    hasCard,
    done: done.sort(byRecent),
    // Lo vencido primero: es lo que hay que resolver hoy.
    pending: pending.sort((a, b) => {
      if (!a.at && !b.at) return 0;
      if (!a.at) return 1;
      if (!b.at) return -1;
      return a.at.localeCompare(b.at);
    }),
    scheduled,
    cycles: cycles.slice().reverse(),
    truncated
  };
}
