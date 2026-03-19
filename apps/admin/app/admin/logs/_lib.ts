import { Prisma } from "@prisma/client";

export const DEFAULT_LOG_WINDOW_DAYS = 90;

export function parseDate(raw: string, opts?: { end?: boolean }) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const end = Boolean(opts?.end);
  const isDateOnly = raw.length === 10 && /\d{4}-\d{2}-\d{2}/.test(raw);
  if (end && isDateOnly) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

export function defaultFromDate() {
  return new Date(Date.now() - DEFAULT_LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function pickProviderFailureMessage(providerResponse: unknown): string | null {
  if (!providerResponse || typeof providerResponse !== "object") return null;
  const root = providerResponse as Record<string, any>;
  const candidates = [root?.status_message, root?.statusMessage, root?.reason, root?.error, root?.error_message];
  for (const candidate of candidates) {
    const text = stringOrNull(candidate);
    if (text) return text;
  }
  const errorObj = root?.error;
  if (errorObj && typeof errorObj === "object") {
    const maybeMessage =
      stringOrNull((errorObj as any).message) ||
      stringOrNull((errorObj as any).reason) ||
      stringOrNull((errorObj as any).type);
    if (maybeMessage) return maybeMessage;
    const messages = (errorObj as any).messages;
    if (messages && typeof messages === "object") {
      for (const value of Object.values(messages as Record<string, any>)) {
        if (Array.isArray(value)) {
          const first = value.map((v) => stringOrNull(v)).find(Boolean);
          if (first) return first;
        }
        const text = stringOrNull(value);
        if (text) return text;
      }
    }
  }
  const webhookTx = root?.webhook?.data?.transaction;
  if (webhookTx && typeof webhookTx === "object") {
    const webhookMsg =
      stringOrNull((webhookTx as any).status_message) ||
      stringOrNull((webhookTx as any).statusMessage) ||
      stringOrNull((webhookTx as any).status_reason);
    if (webhookMsg) return webhookMsg;
  }
  return null;
}

export function buildSystemLogWhere(params: {
  q?: string;
  level?: string;
  customerId?: string;
  fromDate: Date;
  toDate?: Date | null;
  ids?: string[];
}) {
  const { q, level, customerId, fromDate, toDate, ids } = params;
  const where: Prisma.SystemLogWhereInput | undefined = q
    ? {
        OR: [
          { message: { contains: q, mode: "insensitive" } },
          { source: { contains: q, mode: "insensitive" } }
        ]
      }
    : undefined;
  const dateFilter = {
    createdAt: {
      gte: fromDate,
      ...(toDate ? { lt: toDate } : {})
    }
  };
  const levelFilter = level ? { level } : null;
  const customerFilter = customerId
    ? ({ context: { path: ["customerId"], equals: customerId } } as Prisma.SystemLogWhereInput)
    : null;
  const finalWhere = {
    ...(where || {}),
    ...(dateFilter || {}),
    ...(levelFilter || {}),
    ...(customerFilter || {})
  } as Prisma.SystemLogWhereInput;
  if (ids && ids.length) {
    (finalWhere as any).id = { in: ids };
  }
  return finalWhere;
}
