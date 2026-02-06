import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { loadEnv } from "../config/env";
import { LogLevel, RetryJobStatus, RetryJobType } from "@prisma/client";
import { forwardWompiToShopify, processWompiEvent } from "./handlers/processWompiEvent";
import { sendChatwootMessage } from "./handlers/sendChatwootMessage";
import { paymentRetry } from "./handlers/paymentRetry";
import { subscriptionReminder } from "./handlers/subscriptionReminder";
import { systemLog } from "../services/systemLog";
import { billingMonthlyReport } from "./handlers/billingMonthlyReport";

loadEnv(process.env);
const workerId = `jobs:${process.pid}`;

const BOGOTA_UTC_OFFSET_MS = -5 * 60 * 60 * 1000;

function monthKeyUtc(y: number, m0: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

function computeNextMonthlyReportJob(nowMs: number) {
  const bogotaNow = new Date(nowMs + BOGOTA_UTC_OFFSET_MS);
  const y = bogotaNow.getUTCFullYear();
  const m = bogotaNow.getUTCMonth();
  const d = bogotaNow.getUTCDate();
  const hh = bogotaNow.getUTCHours();
  const mm = bogotaNow.getUTCMinutes();

  const isDay1Before005 = d === 1 && hh === 0 && mm < 5;
  const runY = isDay1Before005 ? y : m === 11 ? y + 1 : y;
  const runM = isDay1Before005 ? m : (m + 1) % 12;
  const runAt = new Date(Date.UTC(runY, runM, 1, 5, 5, 0, 0)); // 00:05 Bogotá = 05:05 UTC

  const prevM = runM === 0 ? 11 : runM - 1;
  const prevY = runM === 0 ? runY - 1 : runY;
  const periodKey = monthKeyUtc(prevY, prevM);

  return { runAt, periodKey };
}

async function claimJobs(limit: number) {
  return prisma.$queryRaw<
    Array<{ id: string; type: RetryJobType; payload: any; attempts: number; maxAttempts: number }>
  >`
    WITH picked AS (
      SELECT id
      FROM "RetryJob"
      WHERE "status" = 'PENDING'::"RetryJobStatus"
        AND "runAt" <= now()
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "RetryJob" r
    SET "status" = 'RUNNING'::"RetryJobStatus", "lockedAt" = now(), "lockedBy" = ${workerId}, "updatedAt" = now()
    FROM picked
    WHERE r.id = picked.id
    RETURNING r.id, r.type, r.payload, r.attempts, r."maxAttempts";
  `;
}

function nextRunAt(attempts: number) {
  const baseMs = 5_000;
  const delayMs = Math.min(5 * 60_000, baseMs * Math.pow(2, Math.max(0, attempts)));
  return new Date(Date.now() + delayMs);
}

let lastEnsureAtMs = 0;
async function ensureMonthlyBillingReportJob() {
  const now = Date.now();
  if (now - lastEnsureAtMs < 60_000) return;
  lastEnsureAtMs = now;

  const next = computeNextMonthlyReportJob(now);

  const existing = await prisma.retryJob.findFirst({
    where: {
      type: RetryJobType.BILLING_MONTHLY_REPORT,
      payload: { path: ["periodKey"], equals: next.periodKey } as any
    } as any
  });
  if (existing) return;

  await prisma.retryJob
    .create({
      data: {
        type: RetryJobType.BILLING_MONTHLY_REPORT,
        runAt: next.runAt,
        maxAttempts: 10,
        payload: { periodKey: next.periodKey }
      } as any
    })
    .catch(() => {});
}

async function runOnce() {
  const jobs = await claimJobs(10);
  for (const job of jobs) {
    try {
      const payload = job.payload as any;

      if (job.type === RetryJobType.PROCESS_WOMPI_EVENT) {
        await processWompiEvent(payload.webhookEventId);
      } else if (job.type === RetryJobType.FORWARD_WOMPI_TO_SHOPIFY) {
        await forwardWompiToShopify(payload.webhookEventId);
      } else if (job.type === RetryJobType.SEND_CHATWOOT_MESSAGE) {
        await sendChatwootMessage(payload.chatwootMessageId);
      } else if (job.type === RetryJobType.PAYMENT_RETRY) {
        await paymentRetry(payload);
      } else if (job.type === RetryJobType.SUBSCRIPTION_REMINDER) {
        await subscriptionReminder(payload);
      } else if (job.type === RetryJobType.BILLING_MONTHLY_REPORT) {
        await billingMonthlyReport(payload);
      } else {
        logger.warn({ jobId: job.id, type: job.type }, "Unhandled job type");
      }

      await prisma.retryJob.update({
        where: { id: job.id },
        data: { status: RetryJobStatus.SUCCEEDED, lockedAt: null, lockedBy: null }
      });
    } catch (err: any) {
      const attempts = job.attempts + 1;
      const status = attempts >= job.maxAttempts ? RetryJobStatus.FAILED : RetryJobStatus.PENDING;
      await prisma.retryJob.update({
        where: { id: job.id },
        data: {
          status,
          attempts,
          lastError: err?.message ? String(err.message) : "unknown error",
          runAt: status === RetryJobStatus.PENDING ? nextRunAt(attempts) : undefined,
          lockedAt: null,
          lockedBy: null
        }
      });
      logger.error({ jobId: job.id, err }, "Job failed");
      await systemLog(LogLevel.ERROR, "jobs.runner", "Job failed", {
        jobId: job.id,
        type: job.type,
        attempts,
        err: err?.message || String(err)
      }).catch(
        () => {}
      );
    }
  }
}

async function main() {
  logger.info({ workerId }, "Jobs runner started");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await ensureMonthlyBillingReportJob();
      await runOnce();
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err: any) {
      const msg = err?.meta?.message || err?.message || String(err);
      // Common during first boot if migrations haven't been applied yet.
      logger.warn({ err: msg }, "Jobs runner transient failure; retrying soon");
      const short = String(msg || "").replace(/\s+/g, " ").trim().slice(0, 240);
      await systemLog(
        LogLevel.WARN,
        "jobs.runner",
        short ? `Transient failure (will retry): ${short}` : "Transient failure (will retry)",
        { err: msg }
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Jobs runner crashed");
  process.exit(1);
});
