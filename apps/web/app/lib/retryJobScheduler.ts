import { RetryJobStatus, RetryJobType } from "@prisma/client";
import { prisma } from "../db/prisma";

const ACTIVE_JOB_STATUSES: RetryJobStatus[] = [RetryJobStatus.PENDING, RetryJobStatus.RUNNING];
const SAME_SLOT_TOLERANCE_MS = 60_000;

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

  if (targetRunAt.getTime() < existing.runAt.getTime()) {
    return db.retryJob.update({
      where: { id: existing.id },
      data: {
        runAt: targetRunAt,
        maxAttempts: Math.max(existing.maxAttempts, maxAttempts),
        updatedAt: new Date()
      }
    });
  }

  return existing;
}
