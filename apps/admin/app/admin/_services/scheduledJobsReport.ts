import "server-only";

import { prisma } from "@suscripciones/database";

export type ScheduledJobRow = {
  id: string;
  type: string;
  label: string;
  status: string;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  customerName: string | null;
  detail: string | null;
};

export type ScheduledJobsReport = {
  pending: number;
  running: number;
  failed: number;
  overdue: number;
  nextRunAt: string | null;
  rows: ScheduledJobRow[];
};

/** Qué hace cada job, en términos del negocio y no del código. */
export const JOB_LABEL: Record<string, string> = {
  PAYMENT_RETRY: "Cobro / reintento de cobro",
  SUBSCRIPTION_REMINDER: "Aviso de vencimiento o mora",
  SEND_CHATWOOT_MESSAGE: "Envío de WhatsApp",
  SEND_CAMPAIGN: "Campaña masiva",
  PROCESS_WOMPI_EVENT: "Procesar evento de Wompi",
  FORWARD_WOMPI_TO_SHOPIFY: "Reenvío de pago a Shopify",
  BILLING_MONTHLY_REPORT: "Reporte mensual de facturación",
  SYNC_SMART_LISTS: "Sincronizar listas",
  GAMIFICATION_RECALC: "Recalcular gamificación",
  DATA_TRAINER: "Entrenamiento de datos",
  AI_ASSIST: "Asistente IA"
};

/** Motivo del aviso, para distinguir un recordatorio de una notificación de mora. */
export const TRIGGER_LABEL: Record<string, string> = {
  SUBSCRIPTION_DUE: "vencimiento de suscripción",
  PAYMENT_APPROVED: "pago aprobado",
  PAYMENT_DECLINED: "pago rechazado",
  PAYMENT_LINK_CREATED: "link de pago creado"
};

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Qué hay agendado y para quién. Sin esto, saber si a un cliente le va a
 * llegar un cobro o un aviso —y a qué hora— obliga a leer la tabla de jobs
 * a mano y a traducir el payload de cada tipo.
 */
export async function getScheduledJobsReport(args?: { take?: number }): Promise<ScheduledJobsReport> {
  const take = Math.min(Math.max(Number(args?.take ?? 40), 1), 200);
  const now = new Date();

  // De los fallidos solo interesa cuántos son: el motivo se revisa en el log,
  // no en el tablero.
  const [active, failedCount] = await Promise.all([
    prisma.retryJob.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      orderBy: [{ runAt: "asc" }],
      take
    }),
    prisma.retryJob.count({ where: { status: "FAILED" } })
  ]);

  const all = active;

  // Los payloads apuntan a distintas entidades según el tipo, así que se
  // resuelven en lote y después se cruzan con cada job.
  const subscriptionIds = new Set<string>();
  const customerIds = new Set<string>();
  const messageIds = new Set<string>();

  for (const job of all) {
    const subId = readString(job.payload, "subscriptionId");
    if (subId) subscriptionIds.add(subId);
    const custId = readString(job.payload, "customerId");
    if (custId) customerIds.add(custId);
    const msgId = readString(job.payload, "chatwootMessageId");
    if (msgId) messageIds.add(msgId);
  }

  const [subs, customers, messages] = await Promise.all([
    subscriptionIds.size
      ? prisma.subscription.findMany({
          where: { id: { in: Array.from(subscriptionIds) } },
          select: { id: true, customer: { select: { name: true } } }
        })
      : Promise.resolve([]),
    customerIds.size
      ? prisma.customer.findMany({
          where: { id: { in: Array.from(customerIds) } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    messageIds.size
      ? prisma.chatwootMessage.findMany({
          where: { id: { in: Array.from(messageIds) } },
          select: { id: true, type: true, customer: { select: { name: true } } }
        })
      : Promise.resolve([])
  ]);

  const subName = new Map<string, string | null>(subs.map((s) => [s.id, s.customer?.name ?? null]));
  const custName = new Map<string, string | null>(customers.map((c) => [c.id, c.name ?? null]));
  const msgInfo = new Map<string, { type: string; name: string | null }>(
    messages.map((m) => [m.id, { type: String(m.type), name: m.customer?.name ?? null }])
  );

  function toRow(job: (typeof all)[number]): ScheduledJobRow {
    const type = String(job.type);
    const subId = readString(job.payload, "subscriptionId");
    const custId = readString(job.payload, "customerId");
    const msgId = readString(job.payload, "chatwootMessageId");
    const trigger = readString(job.payload, "trigger");

    const message = msgId ? msgInfo.get(msgId) ?? null : null;
    const customerName =
      (subId ? subName.get(subId) ?? null : null) ||
      (custId ? custName.get(custId) ?? null : null) ||
      (message?.name ?? null);

    let detail: string | null = null;
    if (trigger) detail = TRIGGER_LABEL[trigger] ?? trigger;
    else if (message) detail = message.type;

    return {
      id: job.id,
      type,
      label: JOB_LABEL[type] ?? type,
      status: String(job.status),
      runAt: job.runAt.toISOString(),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      customerName,
      detail
    };
  }

  const rows = active.map(toRow);

  return {
    pending: active.filter((j) => String(j.status) === "PENDING").length,
    running: active.filter((j) => String(j.status) === "RUNNING").length,
    failed: failedCount,
    overdue: active.filter((j) => j.runAt.getTime() < now.getTime()).length,
    nextRunAt: rows.length ? rows[0].runAt : null,
    rows
  };
}
