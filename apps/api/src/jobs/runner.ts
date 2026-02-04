import { prisma } from "../db/prisma";
import { logger } from "../lib/logger";
import { loadEnv } from "../config/env";
import { LogLevel, RetryJobStatus, RetryJobType } from "@prisma/client";
import { forwardWompiToShopify, processWompiEvent } from "./handlers/processWompiEvent";
import { sendChatwootMessage } from "./handlers/sendChatwootMessage";
import { paymentRetry } from "./handlers/paymentRetry";
import { systemLog } from "../services/systemLog";

loadEnv(process.env);
const workerId = `jobs:${process.pid}`;

async function claimJobs(limit: number) {
  return prisma.$queryRaw<
    Array<{ id: string; type: RetryJobType; payload: any; attempts: number; maxAttempts: number }>
  >`
    WITH picked AS (
      SELECT id
      FROM "RetryJob"
      WHERE status = ${RetryJobStatus.PENDING}
        AND "runAt" <= now()
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "RetryJob" r
    SET status = ${RetryJobStatus.RUNNING}, "lockedAt" = now(), "lockedBy" = ${workerId}, "updatedAt" = now()
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
      await runOnce();
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err: any) {
      const msg = err?.meta?.message || err?.message || String(err);
      // Common during first boot if migrations haven't been applied yet.
      logger.warn({ err: msg }, "Jobs runner transient failure; retrying soon");
      await systemLog(LogLevel.WARN, "jobs.runner", "Transient failure (will retry)", { err: msg }).catch(() => {});
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Jobs runner crashed");
  process.exit(1);
});
