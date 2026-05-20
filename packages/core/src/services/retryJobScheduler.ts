import { RetryJobStatus, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getAutoDebitConfig, type AutoDebitConfig } from "./runtimeConfig";
import { applyClockTimeInZone } from "../lib/timeZoneScheduling";

const ACTIVE_JOB_STATUSES: RetryJobStatus[] = [RetryJobStatus.PENDING, RetryJobStatus.RUNNING];
const SAME_SLOT_TOLERANCE_MS = 60_000;

export async function resolvePaymentRetryRunAt(args: {
  dueAt: Date;
  now?: Date;
  config?: Pick<AutoDebitConfig, "executionHour" | "timeZone"> | null;
}) {
  const now = args.now instanceof Date && !Number.isNaN(args.now.getTime()) ? args.now : new Date();
  const rawDueAt = args.dueAt instanceof Date && !Number.isNaN(args.dueAt.getTime()) ? args.dueAt : now;
  const cfg =
    args.config ||
    (await getAutoDebitConfig().catch(() => ({ executionHour: "09:00", timeZone: "America/Bogota" })));
  const executionHour = String(cfg?.executionHour || "09:00").trim() || "09:00";
  const timeZone = String(cfg?.timeZone || "America/Bogota").trim() || "America/Bogota";

  const scheduledForDueDay = applyClockTimeInZone(rawDueAt, executionHour, timeZone);
  if (scheduledForDueDay.getTime() > now.getTime()) return scheduledForDueDay;

  const scheduledForToday = applyClockTimeInZone(now, executionHour, timeZone);
  if (scheduledForToday.getTime() > now.getTime()) return scheduledForToday;

  return now;
}

export async function ensurePaymentRetryJob(args: {
  subscriptionId: string;
  runAt: Date;
  maxAttempts?: number;
  db?: Pick<typeof prisma, "retryJob">;
}) {
  const subscriptionId = String(args.subscriptionId || "").trim();
  if (!subscriptionId) return null;
  const db = args.db ?? prisma;
  const maxAttempts = Number.isFinite(args.maxAttempts as number) ? Math.max(1, Math.trunc(args.maxAttempts as number)) : 1;
  const targetRunAt = args.runAt instanceof Date && !Number.isNaN(args.runAt.getTime()) ? args.runAt : new Date();

  const existing = await db.retryJob.findFirst({
    where: {
      type: RetryJobType.PAYMENT_RETRY,
      status: { in: ACTIVE_JOB_STATUSES },
      payload: { path: ["subscriptionId"], equals: subscriptionId } as any
    },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, runAt: true, maxAttempts: true }
  });

  if (!existing) {
    return db.retryJob.create({
      data: {
        type: RetryJobType.PAYMENT_RETRY,
        runAt: targetRunAt,
        maxAttempts,
        payload: { subscriptionId }
      }
    });
  }

  const sameSlot = Math.abs(existing.runAt.getTime() - targetRunAt.getTime()) <= SAME_SLOT_TOLERANCE_MS;
  if (sameSlot) return existing;

  return db.retryJob.update({
    where: { id: existing.id },
    data: {
      runAt: targetRunAt,
      maxAttempts: Math.max(existing.maxAttempts, maxAttempts),
      updatedAt: new Date()
    }
  });
}
